# 妖火账号注册 / 登录

官方文档：<https://yaohuo.me/OAuth/Docs.html>
Discovery：<https://yaohuo.me/.well-known/openid-configuration>

使用 OIDC 而不是仅 OAuth Profile。服务端校验 ID Token 的签名、issuer、audience、nonce 和有效期，身份以 `(issuer, sub)` 保存。无需真实邮箱，不使用 `Profile.aspx` 或虚拟邮箱做账户匹配。

## 1. 申请应用

向妖火站点管理员申请 **OIDC 机密 Web 客户端** Client ID 与 Client Secret。申请说明：

- 网站：`https://farm.xaitr.com`
- 回调：`https://farm.xaitr.com/api/oauth/oidc/callback`（精确匹配）
- Scope：`openid profile`
- Token 鉴权：`client_secret_post`
- PKCE：关闭（按官方机密客户端推荐；state/nonce/签名校验保持开启）

## 2. 在部署服务器配置

在服务器本地 `.env` 中设置，不要上传真实密钥：

```dotenv
AUTH_PUBLIC_URL=https://farm.xaitr.com
OIDC_AUTO_REGISTER=true
OIDC_NAME=妖火
OIDC_ISSUER=https://yaohuo.me
OIDC_CLIENT_ID=替换为妖火分配的ID
OIDC_CLIENT_SECRET=替换为妖火分配的密钥
OIDC_SCOPES=openid profile
OIDC_TOKEN_AUTH_METHOD=client_secret_post
OIDC_PKCE=false
```

`OIDC_ISSUER` 不要加尾斜杠。默认 PKCE 仍为开启，仅此通用 OIDC 提供方显式关闭；Google 不受该开关影响。文档虽为机密客户端推荐关闭 PKCE，当前 discovery 也声明 S256；如果妖火管理员明确为你的应用开启并要求 PKCE，可以改回 true。

## 3. 更新运行服务

```bash
git pull --ff-only
docker compose up -d --build
```

源码运行应使用原进程管理器注入这些环境变量并重新启动；项目不会自动为源码启动读取 `.env`。

部署检查：访问 `https://farm.xaitr.com/api/oauth/providers` 应包含 `id: "oidc", name: "妖火"`，然后登录页会出现「使用 妖火 注册 / 登录」。首次认证成功自动创建普通用户，仅能管理自己的游戏账号。

代码更新不等于网站启用：如果该接口仍返回 `data: []`，说明运行容器没有收到 Client ID/Secret/Issuer，检查 `.env`、Compose 更新及容器重建。严禁把本地 `.env` 提交到仓库。

尚未取得该站真实客户端凭据，因此只完成兼容实现和自动化测试，未宣称完成真实妖火账号登录验证。首次上线需用测试用户验证完整授权回调与隔离行为。
