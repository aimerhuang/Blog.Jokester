export const siteConfig = {
  name: "Blog.Jokester",
  description: "Blog.Jokester 内容站点",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  author: {
    name: "Blog.Jokester",
    url: "http://localhost:8091",
    github: "",
    email: "",
  },
  links: {
    github: "",
    docs: "",
  },
};

export const navConfig = {
  mainNav: [
    { href: "/", label: "首页" },
    { href: "/archives", label: "归档" },
    { href: "/about", label: "关于" },
  ],
  adminNav: [
    { href: "/admin", label: "仪表盘", icon: "LayoutDashboard" },
    { href: "/admin/articles", label: "文章管理", icon: "FileText" },
    { href: "/admin/comments", label: "评论管理", icon: "MessageSquare" },
    { href: "/admin/settings", label: "系统设置", icon: "Settings" },
  ],
};
