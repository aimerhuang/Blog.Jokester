# Blog.Jokester 生产部署手册

本文记录 Blog.Jokester 在 Linux 服务器上的完整生产部署流程。推荐方案为：

- Docker Compose 管理 Blog.Jokester、PostgreSQL 和 Redis；
- Blog.Jokester 容器同时运行 Go API 与内置 Next.js 前端；
- Nginx 或 Caddy 对外提供 HTTPS，并反向代理到 `127.0.0.1:8091`；
- PostgreSQL、Redis 和应用数据全部持久化，并在每次升级前备份。

本文命令默认在仓库根目录执行，并使用以下示例值：

| 项目 | 示例值 | 部署时替换为 |
| --- | --- | --- |
| 安装目录 | `/opt/blog-jokester` | 实际项目目录 |
| 域名 | `blog.example.com` | 已解析到服务器的域名 |
| 应用端口 | `8091` | 通常保持默认值 |
| PostgreSQL 数据库/用户 | `anheyu` | Compose 默认值 |

> 生产操作前先阅读“备份与恢复”。不要执行 `docker compose down -v`，该命令会删除 PostgreSQL 与 Redis 命名卷。

## 1. 部署架构

```text
访客浏览器
    |
    | HTTPS :443
    v
Nginx / Caddy
    |
    | HTTP 127.0.0.1:8091
    v
blog-jokester 容器
    |-- Go API :8091
    |-- Next.js :3000（仅容器内部，由 Go 进程启动并代理）
    |
    +-- PostgreSQL :5432（仅 Compose 内部网络）
    +-- Redis :6379（仅 Compose 内部网络）
```

当前 `Dockerfile` 是“运行时镜像”：它会复制已经编译好的 `blog-jokester` 和 `frontend/.next`，**不会在 Docker 构建期间编译 Go 或 Next.js**。因此生产部署必须先生成与服务器 CPU 架构匹配的后端二进制和前端构建产物，再执行 `docker compose up --build`。

## 2. 服务器要求

### 2.1 推荐配置

- Linux x86_64/AMD64 或 ARM64；
- 2 核 CPU、2 GB 内存起步，建议 4 GB 内存；
- 至少 10 GB 可用磁盘，上传大量媒体时按实际容量扩容；
- Docker Engine 与 Docker Compose v2；
- 构建机需要 Go `1.25+`、Node.js `20.19+`、npm 和 Git；
- 开放公网端口 `80/tcp`、`443/tcp`，SSH 端口按服务器实际配置开放；
- 不向公网开放 PostgreSQL `5432`、Redis `6379` 和应用源站端口 `8091`。

构建可以直接在生产服务器完成，也可以在相同 CPU 架构的 CI/构建机完成后上传产物。只负责运行容器的服务器不需要安装 Go 和 npm。

### 2.2 检查环境

```bash
uname -m
docker --version
docker compose version
git --version
go version
node --version
npm --version
```

`uname -m` 常见结果：

- `x86_64`：使用 `GOARCH=amd64`；
- `aarch64` 或 `arm64`：使用 `GOARCH=arm64`。

建议为生产服务器配置 NTP 时间同步，并确认 `date` 输出正确。容器时区已配置为 `Asia/Shanghai`。

## 3. DNS 与目录准备

先在 DNS 服务商处添加 A/AAAA 记录，将 `blog.example.com` 指向服务器公网地址。可用以下命令检查解析结果：

```bash
getent hosts blog.example.com
```

准备安装目录并获取代码。仓库内已经包含前端普通源码，无需初始化 Git 子模块：

```bash
sudo mkdir -p /opt/blog-jokester
sudo chown -R "$USER":"$USER" /opt/blog-jokester
git clone <你的仓库地址> /opt/blog-jokester
cd /opt/blog-jokester
git rev-parse --short HEAD
```

如果代码通过压缩包或发布系统上传，也要保证最终目录包含 `frontend/`、`Dockerfile`、`docker-compose.yml`、`entrypoint.sh` 和 `default_files/`。

## 4. 配置密钥

复制环境变量模板，并生成两个互不相同的强密码：

```bash
cd /opt/blog-jokester
cp .env.example .env
DB_PASSWORD="$(openssl rand -hex 32)"
REDIS_PASSWORD="$(openssl rand -hex 32)"
sed -i "s|^ANHEYU_DATABASE_PASSWORD=.*|ANHEYU_DATABASE_PASSWORD=${DB_PASSWORD}|" .env
sed -i "s|^ANHEYU_REDIS_PASSWORD=.*|ANHEYU_REDIS_PASSWORD=${REDIS_PASSWORD}|" .env
unset DB_PASSWORD REDIS_PASSWORD
chmod 600 .env
```

检查变量存在，但不要把完整输出粘贴到工单或聊天中：

```bash
grep -E '^(ANHEYU_DATABASE_PASSWORD|ANHEYU_REDIS_PASSWORD)=' .env | sed 's/=.*/=<已设置>/'
```

注意：

- `.env` 已被 `.gitignore` 忽略，禁止提交到 Git；
- 两个密码不能使用模板值、`changeme` 或相同内容；
- `.env` 中的 PostgreSQL 密码只在数据库卷首次初始化时自动创建。数据库已有数据后直接修改 `.env` 不会同步修改数据库账号密码，密码轮换见第 13.3 节；
- 应用的站点域名、标题、Logo、SMTP 和对象存储等业务配置在首次启动后通过后台设置，不写入此 `.env`。

## 5. 构建生产产物

### 5.1 构建 Next.js 前端

```bash
cd /opt/blog-jokester/frontend
npm ci
npm run build
cd ..
```

确认 Dockerfile 需要的三个路径存在：

```bash
test -f frontend/.next/standalone/server.js
test -d frontend/.next/static
test -d frontend/public
```

构建失败时先检查 Node.js 版本、磁盘空间和 npm 输出。不要用 `npm run dev` 的产物部署生产环境。

### 5.2 构建 Go 后端

下面的命令自动匹配当前 Linux 服务器架构，并把结果写到 Dockerfile 固定读取的 `blog-jokester`：

```bash
cd /opt/blog-jokester
case "$(uname -m)" in
  x86_64) GOARCH=amd64 ;;
  aarch64|arm64) GOARCH=arm64 ;;
  *) echo "不支持的 CPU 架构: $(uname -m)"; exit 1 ;;
esac

VERSION="$(git describe --tags --always --dirty)"
COMMIT="$(git rev-parse --short HEAD)"
BUILD_DATE="$(date -u '+%Y-%m-%d %H:%M:%S')"
CGO_ENABLED=0 GOOS=linux GOARCH="$GOARCH" go build \
  -ldflags "-X 'github.com/anzhiyu-c/anheyu-app/internal/pkg/version.Version=${VERSION}' -X 'github.com/anzhiyu-c/anheyu-app/internal/pkg/version.Commit=${COMMIT}' -X 'github.com/anzhiyu-c/anheyu-app/internal/pkg/version.Date=${BUILD_DATE}'" \
  -o blog-jokester .
unset GOARCH VERSION COMMIT BUILD_DATE
chmod 755 blog-jokester
file blog-jokester
```

`file blog-jokester` 必须显示 Linux ELF，且架构与服务器一致。若显示 Mach-O，说明误用了 macOS 二进制；若 AMD64/ARM64 不匹配，容器会报 `exec format error`。

## 6. 持久化目录与端口

创建宿主机目录。容器内应用用户 UID/GID 为 `1001:1001`，提前设置所有可写目录的权限：

```bash
cd /opt/blog-jokester
mkdir -p data themes static backup
sudo chown -R 1001:1001 data themes static backup
sudo chmod -R u+rwX,go-rwx data themes static backup
```

主 Compose 文件的持久化内容如下：

| 数据 | 宿主机/卷 | 是否必须备份 |
| --- | --- | --- |
| 配置、本地文件、缓存 | `./data` | 是，至少备份配置和本地上传文件 |
| 主题 | `./themes` | 是 |
| 当前静态主题 | `./static` | 是 |
| 应用内备份 | `./backup` | 是 |
| PostgreSQL | `blog_jokester_database_postgres` 命名卷 | 是，使用 `pg_dump` |
| Redis | `blog_jokester_redis_data` 命名卷 | 通常不需要，Redis 为缓存/索引 |

默认 `docker-compose.yml` 中的 `8091:8091` 会监听所有网卡。使用本机 Nginx/Caddy 时，建议改成只监听回环地址：

```yaml
ports:
  - "127.0.0.1:8091:8091"
```

修改后用 `docker compose config` 确认 `published` 为 `8091`，并用 `ss -lntp | grep 8091` 确认监听地址。若反向代理也运行在 Docker 中，则应让代理加入同一 Docker 网络并通过服务名访问，不要照搬回环地址配置。

## 7. 首次启动

### 7.1 校验 Compose

```bash
cd /opt/blog-jokester
docker compose config >/dev/null
docker compose config --services
```

期望包含：

```text
blog-jokester
blog_jokester_postgresql
blog_jokester_redis
```

`docker compose config` 的完整输出包含解析后的密码，不要公开保存或发送。

### 7.2 先启动依赖

当前 Compose 的 `depends_on` 只保证启动顺序，不等待数据库就绪。首次部署建议先启动 PostgreSQL 与 Redis，并等待检查通过：

```bash
docker compose up -d blog_jokester_postgresql blog_jokester_redis

until docker compose exec -T blog_jokester_postgresql pg_isready -U anheyu -d anheyu; do
  sleep 2
done

set -a
. ./.env
set +a
until docker compose exec -T blog_jokester_redis \
  redis-cli -a "$ANHEYU_REDIS_PASSWORD" ping | grep -q PONG; do
  sleep 2
done
unset ANHEYU_DATABASE_PASSWORD ANHEYU_REDIS_PASSWORD
```

### 7.3 构建镜像并启动应用

```bash
docker compose up -d --build blog-jokester
docker compose ps
docker compose logs --tail=200 blog-jokester
```

应用容器首次启动时会：

1. 将默认 `conf.ini` 和默认文章模板写入空的 `data/`；
2. 连接 PostgreSQL 并自动迁移数据库结构；
3. 连接 Redis；
4. 启动内置 Next.js 服务；
5. 在 `8091` 端口启动 Go 服务。

日志中应能看到数据库连接、数据库迁移、前端启动和 `正在监听端口: 8091` 等成功信息。首次启动可能需要数十秒。

## 8. 部署验证

项目当前没有独立的 `/health` 就绪探针。使用公开站点配置接口同时验证 Go、数据库和路由：

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:8091/api/public/site-config >/dev/null
echo $?

curl --fail --silent --show-error \
  -o /dev/null -w 'HTTP %{http_code}\n' \
  http://127.0.0.1:8091/
```

两条命令都应成功，首页应返回 `HTTP 200`。继续检查：

```bash
docker compose ps
docker compose exec -T blog_jokester_postgresql \
  pg_isready -U anheyu -d anheyu
docker compose logs --since=10m blog-jokester | grep -iE 'error|fatal|panic' || true
```

若首页失败但 API 成功，检查内置前端日志：

```bash
docker compose exec blog-jokester \
  sh -c 'tail -n 200 /anheyu/frontend/frontend.log'
```

## 9. 配置 HTTPS 反向代理

### 9.1 Nginx

安装 Nginx 后创建站点配置，例如 `/etc/nginx/conf.d/blog-jokester.conf`：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name blog.example.com;

    client_max_body_size 1g;

    location / {
        proxy_pass http://127.0.0.1:8091;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
```

检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

确认 HTTP 可访问后，用 Certbot 或服务器已有证书系统申请证书。使用 Certbot 的常见命令为：

```bash
sudo certbot --nginx -d blog.example.com
sudo certbot renew --dry-run
```

Certbot 完成后检查 `https://blog.example.com`，并确认 HTTP 自动跳转 HTTPS。若证书由面板、云负载均衡或 CDN 管理，以实际平台配置为准。

### 9.2 Caddy

Caddy 可以自动申请和续期证书。`/etc/caddy/Caddyfile` 的最小配置：

```caddyfile
blog.example.com {
    request_body {
        max_size 1GB
    }
    reverse_proxy 127.0.0.1:8091
}
```

`request_body max_size` 需要 Caddy `2.10.0+`。旧版本可删除该块，仅保留 `reverse_proxy`，或先升级 Caddy。

检查并重载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

只选择 Nginx 或 Caddy 中的一种，避免同时占用 `80/443`。

### 9.3 防火墙

以 UFW 为例，只开放 SSH、HTTP 和 HTTPS：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

启用防火墙前必须确认 SSH 规则正确。应用端口若已绑定 `127.0.0.1`，无需开放 `8091`。

## 10. 首次后台初始化

1. 访问 `https://blog.example.com/admin`；
2. 按页面提示注册第一个管理员账号并登录；
3. 在后台“系统设置/站点基础设置”中将 `SITE_URL` 改为 `https://blog.example.com`；
4. 修改站点名称、副标题、描述、关键词、Logo、图标和备案信息；
5. 删除或替换默认文章、默认作者资料和演示链接；
6. 根据需要设置注册策略，管理员初始化完成后关闭不必要的公开注册；
7. 启用 SMTP、对象存储、OAuth、评论通知或推送时，逐项使用测试账号验证；
8. 上传一个测试文件，确认 `data/`、`static/` 或已配置的对象存储可写；
9. 检查首页、文章页、后台、上传、搜索、RSS 和站点地图。

站点配置保存于数据库。修改代码中的默认值不会覆盖数据库里已经存在的配置。

## 11. 日常运维

常用命令：

```bash
cd /opt/blog-jokester

docker compose ps
docker compose logs -f --tail=200 blog-jokester
docker compose logs -f --tail=100 blog_jokester_postgresql
docker compose restart blog-jokester
docker compose stop
docker compose start
docker stats
docker system df
du -sh data themes static backup
```

`docker compose down` 会删除容器和网络，但默认保留命名卷；`docker compose down -v` 会删除数据库卷，生产环境禁止使用。

建议配置 Docker 日志轮转，避免容器日志占满磁盘。可以给每个服务增加：

```yaml
logging:
  driver: json-file
  options:
    max-size: "20m"
    max-file: "5"
```

修改 Compose 后执行 `docker compose up -d` 重新创建容器。还应监控：

- HTTPS 可用性和证书到期时间；
- 首页及 `/api/public/site-config` 的 HTTP 状态；
- 容器重启次数、CPU 和内存；
- PostgreSQL 连接和备份结果；
- 磁盘、inode 与上传目录容量；
- 应用日志中的 `panic`、`fatal`、数据库和前端代理错误。

## 12. 备份与恢复

### 12.1 创建完整备份

以下操作把备份写到项目目录之外，避免与应用自己的 `backup/` 混淆：

```bash
cd /opt/blog-jokester
BACKUP_ROOT="/var/backups/blog-jokester/$(date +%Y%m%d-%H%M%S)"
sudo mkdir -p "$BACKUP_ROOT"
sudo chown "$USER":"$USER" "$BACKUP_ROOT"

docker compose exec -T blog_jokester_postgresql \
  pg_dump -U anheyu -d anheyu -Fc \
  > "$BACKUP_ROOT/postgresql.dump"

sudo tar -C /opt/blog-jokester -czf "$BACKUP_ROOT/files.tar.gz" \
  data themes static backup
sudo chown "$USER":"$USER" "$BACKUP_ROOT/files.tar.gz"

cp .env docker-compose.yml "$BACKUP_ROOT/"
git rev-parse HEAD > "$BACKUP_ROOT/git-commit.txt"
docker compose config --images > "$BACKUP_ROOT/images.txt"
chmod 600 "$BACKUP_ROOT/.env" "$BACKUP_ROOT/postgresql.dump"

docker compose exec -T blog_jokester_postgresql \
  pg_restore --list < "$BACKUP_ROOT/postgresql.dump" >/dev/null
tar -tzf "$BACKUP_ROOT/files.tar.gz" >/dev/null
echo "备份完成: $BACKUP_ROOT"
```

上述命令会使用 PostgreSQL 容器内的 `pg_restore` 校验归档目录，并用宿主机 `tar` 校验文件包。备份应复制到另一台服务器或对象存储，不能只留在原服务器。

推荐策略：

- 数据库至少每日备份；
- 文件目录按上传频率每日或每周备份；
- 升级、切换主题、大批量导入前立即备份；
- 保留多个时间点，并定期在隔离环境执行恢复演练；
- 对包含 `.env` 和用户数据的备份加密并限制访问权限。

### 12.2 恢复完整备份

恢复会覆盖当前数据，先再次备份当前状态。确认 `BACKUP_ROOT` 指向要恢复的目录：

```bash
cd /opt/blog-jokester
BACKUP_ROOT=/var/backups/blog-jokester/20260101-120000
RESTORE_STASH="/var/backups/blog-jokester/pre-restore-$(date +%Y%m%d-%H%M%S)"

docker compose stop blog-jokester

sudo mkdir -p "$RESTORE_STASH"
for dir in data themes static backup; do
  if [ -e "$dir" ]; then
    sudo mv "$dir" "$RESTORE_STASH/"
  fi
done
sudo tar -C /opt/blog-jokester -xzf "$BACKUP_ROOT/files.tar.gz"
sudo chown -R 1001:1001 data themes static backup

docker compose exec -T blog_jokester_postgresql \
  dropdb -U anheyu --if-exists --force anheyu
docker compose exec -T blog_jokester_postgresql \
  createdb -U anheyu -T template0 anheyu
docker compose exec -T blog_jokester_postgresql \
  pg_restore -U anheyu -d anheyu --exit-on-error --no-owner \
  < "$BACKUP_ROOT/postgresql.dump"
docker compose exec -T blog_jokester_postgresql \
  psql -U anheyu -d anheyu -c 'ANALYZE;'

docker compose start blog-jokester
docker compose logs --tail=200 blog-jokester
curl --fail http://127.0.0.1:8091/api/public/site-config >/dev/null
```

原文件目录会保存在 `RESTORE_STASH`，确认恢复结果无误后再按保留策略清理。只有在明确需要恢复旧密钥/旧 Compose 配置时才恢复备份中的 `.env` 和 `docker-compose.yml`。恢复 `.env` 后必须重新创建相关容器，并保证数据库账号的实际密码与 `.env` 一致。

## 13. 升级、回滚与密码轮换

### 13.1 标准升级

应用启动时会自动执行数据库结构迁移，而且迁移允许删除旧列/索引，所以**任何版本升级前都必须做 PostgreSQL 备份**。

```bash
cd /opt/blog-jokester
OLD_REF="$(git rev-parse HEAD)"
echo "$OLD_REF"

# 先按第 12.1 节完成完整备份
git status --short
git fetch --tags
git checkout <目标标签或提交>

cd frontend
npm ci
npm run build
cd ..

# 按第 5.2 节重新生成当前服务器架构的 blog-jokester

docker compose build blog-jokester
docker compose up -d --remove-orphans
docker compose ps
docker compose logs --tail=200 blog-jokester
curl --fail http://127.0.0.1:8091/api/public/site-config >/dev/null
```

生产目录应保持干净；若 `git status --short` 有本地修改，先记录并评估，不要直接强制覆盖。升级 PostgreSQL 大版本不能只修改镜像标签，必须按 PostgreSQL 官方流程使用 `pg_upgrade` 或 dump/restore。

`redis:latest` 会随时间变化，稳定生产环境建议将 Compose 中 Redis 固定到已验证的明确版本，并在升级前阅读兼容说明。

### 13.2 回滚

若新版本尚未执行数据库迁移，只需切回旧代码、重新构建并重建应用容器。若新版本已经启动过，应假定数据库结构可能已改变，同时恢复升级前数据库备份：

```bash
cd /opt/blog-jokester
docker compose stop blog-jokester
git checkout "$OLD_REF"

# 重新执行第 5 章构建旧版本产物
# 按第 12.2 节恢复升级前的 PostgreSQL 与文件备份

docker compose build blog-jokester
docker compose up -d blog-jokester
docker compose logs --tail=200 blog-jokester
```

仅回滚应用镜像而不回滚已迁移数据库，可能导致旧版本读取失败。

### 13.3 轮换密码

PostgreSQL 密码需要先在数据库中修改，再更新 `.env`，最后重建应用容器：

```bash
cd /opt/blog-jokester
NEW_DB_PASSWORD="$(openssl rand -hex 32)"
docker compose exec -T blog_jokester_postgresql \
  psql -U anheyu -d postgres \
  -v new_password="$NEW_DB_PASSWORD" <<'SQL'
ALTER USER anheyu WITH PASSWORD :'new_password';
SQL
sed -i "s|^ANHEYU_DATABASE_PASSWORD=.*|ANHEYU_DATABASE_PASSWORD=${NEW_DB_PASSWORD}|" .env
unset NEW_DB_PASSWORD
docker compose up -d --force-recreate blog_jokester_postgresql blog-jokester
```

Redis 密码来自启动命令，更新 `.env` 后需要重建 Redis 和应用容器；重建期间缓存会暂时不可用：

```bash
NEW_REDIS_PASSWORD="$(openssl rand -hex 32)"
sed -i "s|^ANHEYU_REDIS_PASSWORD=.*|ANHEYU_REDIS_PASSWORD=${NEW_REDIS_PASSWORD}|" .env
unset NEW_REDIS_PASSWORD
docker compose up -d --force-recreate blog_jokester_redis blog-jokester
```

轮换后立即执行第 8 章验证，并更新加密保存的运维凭据。

## 14. 常见故障

### 14.1 `exec format error`

`blog-jokester` 与容器/服务器 CPU 架构不一致。运行 `uname -m` 和 `file blog-jokester`，按第 5.2 节重新编译。

### 14.2 Docker 构建提示缺少 `frontend/.next/standalone`

前端尚未构建或构建失败。进入 `frontend` 执行 `npm ci && npm run build`，并检查第 5.1 节的三个路径。

### 14.3 应用反复重启、数据库连接失败

```bash
docker compose ps -a
docker compose logs --tail=200 blog-jokester
docker compose logs --tail=200 blog_jokester_postgresql
docker compose exec -T blog_jokester_postgresql pg_isready -U anheyu -d anheyu
```

常见原因是数据库首次启动尚未完成、`.env` 密码与已有数据库卷中的密码不一致，或数据库卷损坏。不要为了排错直接删除卷。

### 14.4 上传、主题安装或备份提示权限不足

```bash
sudo chown -R 1001:1001 data themes static backup
sudo chmod -R u+rwX,go-rwx data themes static backup
docker compose restart blog-jokester
```

### 14.5 Nginx/Caddy 返回 502

先绕过代理测试源站：

```bash
curl -v http://127.0.0.1:8091/api/public/site-config
docker compose ps
docker compose logs --tail=200 blog-jokester
ss -lntp | grep 8091
```

源站正常时，再检查代理配置、SELinux/AppArmor 和代理日志。

### 14.6 API 正常但页面空白或 404

检查 `frontend/.next` 是否在构建镜像前生成，以及容器内 `/anheyu/frontend/server.js`、`/anheyu/frontend/.next/static` 和 `/anheyu/frontend/public` 是否存在：

```bash
docker compose exec blog-jokester sh -c \
  'ls -l /anheyu/frontend/server.js /anheyu/frontend/.next/static /anheyu/frontend/public'
docker compose exec blog-jokester sh -c \
  'tail -n 200 /anheyu/frontend/frontend.log'
```

### 14.7 磁盘空间不足

```bash
df -h
df -ih
docker system df
du -sh data themes static backup
```

先确认占用来源。可以清理已确认无用的旧镜像和构建缓存，但不要删除正在使用的卷或未核实的上传文件。

## 15. 上线检查表

- [ ] DNS 已解析到正确服务器；
- [ ] `.env` 权限为 `600`，数据库和 Redis 使用不同强密码；
- [ ] Go 二进制为 Linux ELF，CPU 架构正确；
- [ ] Next.js `standalone`、静态资源和 `public` 已构建；
- [ ] `data/`、`themes/`、`static/`、`backup/` 可由 UID 1001 写入；
- [ ] PostgreSQL、Redis 未暴露公网；
- [ ] `8091` 仅监听回环地址或受防火墙限制；
- [ ] HTTPS 证书有效，HTTP 自动跳转 HTTPS；
- [ ] 首页、后台和 `/api/public/site-config` 返回正常；
- [ ] `SITE_URL` 已设置为最终 HTTPS 域名；
- [ ] 管理员使用唯一强密码，注册策略已检查；
- [ ] 默认内容和默认资料已替换；
- [ ] 上传、邮件、对象存储和 OAuth 等已按启用范围测试；
- [ ] 数据库与文件备份已执行并验证，副本保存在异机；
- [ ] 已记录当前 Git 提交、镜像、部署时间和回滚备份位置；
- [ ] 已配置日志轮转、磁盘监控和证书监控。

## 16. 部署记录模板

每次上线建议追加一条记录：

```text
部署时间：
执行人：
环境：生产 / 预发布
域名：
服务器：
CPU 架构：
Git 提交/标签：
应用镜像 ID：
PostgreSQL 版本：
Redis 版本：
配置变更：
数据库迁移：是 / 否
备份目录：
验证结果：首页 / API / 后台 / 上传 / HTTPS
异常与处理：
回滚目标：
```

相关配置项说明见 [CONFIGURATION.zh-CN.md](CONFIGURATION.zh-CN.md)。

## 17. 官方参考

- [Docker Compose 启停顺序与就绪检查](https://docs.docker.com/compose/how-tos/startup-order/)
- [docker compose down 与卷删除选项](https://docs.docker.com/reference/cli/docker/compose/down/)
- [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
- [PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)
- [Caddy request_body 指令](https://caddyserver.com/docs/caddyfile/directives/request_body)
