# Blog.Jokester 配置说明

生产环境从服务器准备、构建、HTTPS、备份到回滚的完整步骤见 [部署手册](DEPLOYMENT.zh-CN.md)。

## 已完成的初始化

- 项目已导入当前目录，后端、Next.js 前端及其依赖源码均已包含；前端已作为普通源码纳入本仓库，无需初始化 Git 子模块。
- 默认站点名称已改为 `Blog.Jokester`。首次启动创建数据库时会写入该名称。
- Docker 服务、容器、卷和本地构建产物使用 `blog-jokester` 标识。
- 上游 Go 模块路径与 `ANHEYU_*` 环境变量保留不变。这是兼容性边界，不是站点显示名称。

## 部署前必须配置

1. 复制环境变量模板：`cp .env.example .env`。
2. 为 `ANHEYU_DATABASE_PASSWORD` 和 `ANHEYU_REDIS_PASSWORD` 分别填写不同的高强度随机密码。生产环境不要使用示例值或 `changeme`。
3. 将 `SITE_URL` 设置为你的最终 HTTPS 域名。首次启动后访问后台的“系统设置/站点基础设置”修改；若已经生成数据，代码中的默认值不会覆盖数据库已有设置。
4. 在同一后台设置站点副标题、描述、关键词、管理员资料、Logo、图标和备案信息。上传 Logo 后更新 `LOGO_URL*` 与 `ICON_URL`。
5. 按需配置邮件、对象存储、OAuth、评论与推送。这些功能不启用时无需填值；启用后务必先用测试账号验证。

## Docker 生产启动

前提：Docker Engine 与 Docker Compose v2 已安装。

当前 `Dockerfile` 打包已经生成的 Go 二进制与 Next.js `standalone` 产物，不会在镜像内编译源码。首次部署或代码更新后，先按 [部署手册第 5 章](DEPLOYMENT.zh-CN.md#5-构建生产产物)完成构建；只有确认产物已经存在且 CPU 架构正确时，才可直接执行下面的启动命令。

```bash
cp .env.example .env
# 编辑 .env，替换两个密码
docker compose up -d --build
docker compose ps
docker compose logs -f blog-jokester
```

浏览器访问 `http://服务器地址:8091` 完成首次管理员初始化。确认正常后，在反向代理中把公网 HTTPS 域名转发到 `127.0.0.1:8091`，并在后台将 `SITE_URL` 改为该域名。默认 Compose 只发布 `8091`；部署到公网时建议由 Nginx、Caddy 或 Traefik 终止 TLS。

持久化数据位于 `data/`、`themes/`、`static/`、`backup/` 和两个 Docker 命名卷。升级前至少备份这些内容与 PostgreSQL 数据库。

### macOS 本机预览

若项目目录不在 Docker Desktop 的 File Sharing 白名单中，可使用命名卷启动预览，无需调整 Docker Desktop 设置：

```bash
docker compose -f docker-compose.yml -f docker-compose.preview.yml up -d
```

该方式将 `data`、`themes`、`static` 和 `backup` 保存到 Docker 命名卷，适合本机预览；生产环境请使用主 Compose 文件的宿主机挂载，或改为你自己的备份策略。

## 源码开发

要求：Go `1.25+`、Node.js `20.19+`、npm，以及可选的 Docker。

```bash
make check-tools
cd frontend && npm ci && npm run dev
```

前端开发服务器是 `http://localhost:3000`，会默认请求后端 `http://localhost:8091`。另开终端启动后端：

```bash
go run .
```

后端默认使用 SQLite 文件 `data/blog_jokester.db`；本地开发不配置 Redis 时使用内存缓存。要验证完整的 PostgreSQL + Redis 部署，使用 Docker Compose 启动。

## 可选环境变量

| 变量 | 用途 | 何时设置 |
| --- | --- | --- |
| `ANHEYU_DATABASE_*` | PostgreSQL/MySQL/SQLite 连接配置 | 使用非默认数据库或 Docker 部署 |
| `ANHEYU_REDIS_ADDR`、`ANHEYU_REDIS_PASSWORD`、`ANHEYU_REDIS_DB` | Redis 缓存与搜索 | 启用 Redis |
| `ANHEYU_FRONTEND_URL` | 使用外置前端服务 | 前后端分离部署 |
| `ANHEYU_FRONTEND_PORT` | 内嵌 Next.js 监听端口 | 修改默认端口 |
| `ANHEYU_MODE=api` | 仅提供后端 API | 外置前端部署 |
| `BACKEND_URL` | Next.js 开发时的后端地址 | 前端与后端不在默认地址 |
| `API_URL` | Next.js 服务端请求的后端地址 | Docker 或 SSR 部署 |
| `NEXT_PUBLIC_SITE_URL` | 前端未取得站点配置时的 SEO 兜底域名 | 外置前端/构建时 SEO |
| `REVALIDATE_TOKEN` | Next.js 缓存刷新令牌 | 启用刷新接口 |

## 首次上线检查

- `.env` 未提交到 Git，两个密码均已替换。
- `SITE_URL` 为真实 HTTPS 地址，且 DNS、反向代理与证书均正常。
- 管理员账号使用唯一强密码，注册策略已按需要关闭或开启。
- 默认演示文章、外链和作者资料已删除或替换。
- 已验证上传目录可写、邮件/对象存储（若启用）可用。
- 已完成数据库与 `data/`、`static/`、`themes/` 的定期备份，并测试过恢复流程。
