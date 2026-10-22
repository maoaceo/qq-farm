# 注册页 Turnstile 人机验证

## 设置位置

使用管理员登录 → 侧栏「用户管理」 → 「注册人机验证 · Cloudflare Turnstile」。

1. 在 Cloudflare Turnstile 创建组件，允许域名 `farm.xaitr.com`（填写你实际使用的域名，不带协议和路径）。建议 Managed 模式。
2. 在后台填写 Site Key 和 Secret Key，勾选「启用注册验证」，保存即可，无需重启。
3. 打开无痕窗口进入普通注册表单，完成人机验证后提交。

Site Key 会提供给注册页，这是公开配置。Secret Key 保存后不回显；再次保存时 Secret Key 留空表示保留已有密钥。更新密钥时输入新值。关闭验证会保留密钥以便以后重新启用。

## 保护边界

仅保护公开用户名/密码注册，不影响普通密码登录、第三方登录、管理员创建用户。管理员可随时关闭此验证。

- 后端向 Cloudflare Siteverify 验证 token，不能只靠前端判断。
- 校验成功结果的 `action` 必须是 `register`；如果配置了 `AUTH_PUBLIC_URL`，同时校验返回 hostname 与该 URL 域名一致。生产环境建议配置 `AUTH_PUBLIC_URL=https://farm.xaitr.com`。
- 缺少 token、无效、重复/过期 token、Cloudflare 超时或验证失败均拒绝注册，不自动绕过。
- 每次提交后前端重置组件/token；过期或错误回调也会清空 token。
- 保留已有的注册尝试限流。
- 配置由管理员权限接口保护；未登录者和普通用户不能读取/修改后台配置。后台响应仅返回 secretConfigured，不返回 Secret Key。

配置保存在运行数据目录 `turnstile.json`（源码为 `core/data/turnstile.json`），随完整数据目录备份。它包含服务器密钥，应限制数据目录权限，禁止上传 GitHub。默认关闭，未配置时原注册流程不受影响。

若部署 CSP，请允许 `https://challenges.cloudflare.com` 的脚本与 iframe；浏览器和服务器必须能够访问 Cloudflare，不能访问时不会放行注册。

## 部署

```bash
git pull --ff-only
docker compose up -d --build
```

代码更新后仍需管理员按上述步骤保存真实密钥。自动化测试使用模拟 Siteverify 响应，不替代真实站点验证。
