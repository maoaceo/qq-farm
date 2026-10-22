# Google / 通用 OIDC 注册与登录

妖火用户可直接参照 [妖火接入步骤](yaohuo.md)。

本地多用户改造版新增 Google 与一个通用 OIDC 提供方入口；可同时启用。它是 OAuth 2.0 Authorization Code + OpenID Connect 身份认证，不支持仅提供 OAuth、没有 ID Token 的提供方（例如不能直接把 GitHub OAuth 当作 OIDC 配置）。

## 管理员配置

1. 配置稳定的 HTTPS 公网域名和反向代理。`AUTH_PUBLIC_URL` 必须是原点，不含路径、查询、凭据或片段，例如 `https://farm.example.com`。
2. Google Cloud Console 创建 OAuth 客户端，类型选 Web application，配置同意屏幕和必要的测试用户/发布状态。
3. Google 的授权重定向 URI 精确填写：
   `https://farm.example.com/api/oauth/google/callback`
4. 通用 OIDC 提供方注册机密 Web 客户端，回调填写：
   `https://farm.example.com/api/oauth/oidc/callback`
5. 复制 `.env.example` 为本地 `.env`，填写对应配置。密钥只放本地/部署 Secret，不要提交 GitHub。

```dotenv
AUTH_PUBLIC_URL=https://farm.example.com
OIDC_AUTO_REGISTER=true
GOOGLE_CLIENT_ID=your-google-web-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# 可选，与 Google 同时使用
OIDC_NAME=公司统一登录
OIDC_ISSUER=https://id.example.com/realms/farm
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

`OIDC_ISSUER` 必须与 discovery 返回的 `issuer` 完全一致（包括尾部斜线）。提供方必须支持 discovery、授权码、JWKS、RS256 或 ES256 ID Token，以及 client_secret_basic 或 client_secret_post。授权和 token/JWKS 等端点都必须 HTTPS。当前不支持自签证书例外、动态用户指定 issuer、多个通用 issuer、设备码、纯 OAuth 或 SAML。

Docker Compose 已透传这些环境变量：修改本地 `.env` 后执行 `docker compose up -d --build`。
**源码启动不会自动读取 `.env`**：请通过 shell export、systemd EnvironmentFile 或进程管理器安全地注入环境变量后再启动。

本机开发允许 `AUTH_PUBLIC_URL=http://localhost:端口`，但实际身份提供方仍须 HTTPS，且开发回调必须在提供方登记。

## 用户行为

- 登录页根据服务器启用配置显示「使用 Google 注册 / 登录」和通用 OIDC 按钮。
- 首次通过可信提供方认证后，若 `OIDC_AUTO_REGISTER=true`，自动创建普通用户；用户名为服务器生成的 `sso_...`，初始没有游戏账号。
- 后续按经过签名验证的 `(issuer, subject)` 找到同一用户。
- 不使用邮箱、显示名或相同用户名自动合并账户；不同 issuer 即使邮箱相同也不会共享账号。当前没有账户绑定/解绑界面。
- 新用户永远不会自动成为管理员。管理员仍使用现有本地密码登录，可禁用新用户及分配游戏账号。普通用户名密码注册是独立入口，由 LOCAL_REGISTRATION_ENABLED 控制。
- 自动注册默认关闭：`OIDC_AUTO_REGISTER=false` 时仅已有身份映射可登录，不会建立新用户。启用即允许该提供方的有效身份自助注册，不额外限制邮箱域名；需要限制来源时应在提供方控制允许的用户群。
- 第三方用户没有初始本地密码，不可直接用空密码或第三方邮箱密码登录。需要本地密码时由管理员在「用户管理」重置，之后可修改自己的密码。身份提供方仍负责其自身密码和 MFA。

## 安全设计与限制

- 使用随机 state、浏览器 HttpOnly/SameSite cookie、nonce，默认启用 PKCE S256（通用 OIDC 可按提供方机密客户端要求显式关闭）；state 有效期5分钟且只能使用一次。
- ID Token 验证签名、issuer、audience、expiry、iat、新鲜度、subject、nonce、authorized party；不信任浏览器提交的身份。
- client secret、ID Token、refresh/access token 不发送到前端。不会保存提供方 refresh token 或 access token。
- 回调通过有效期60秒的一次性 HttpOnly cookie 交接，应用访问令牌只在同源 POST 响应返回，不放 URL 查询/片段。
- 新用户保存于原 users.json；禁用、密码重置和账号隔离沿用多用户版策略。
- discovery 只来自管理员环境配置，配置本身属于受信任服务配置；不要允许不可信用户修改这些环境变量。
- 未启用持久化/分布式登录流程缓存。多副本需粘性会话，重启或回调落到其他副本会导致本次登录失效；重新登录即可。
- 当前应用仍沿用上游 localStorage bearer token，请做好 XSS 防护、HTTPS、访问限制和 CSP；本改造不是完整的身份管理平台。
- 服务端返回通用登录失败信息，不把提供方错误、Code、Token 或 Secret 输出给用户或应用日志。反向代理日志也应避免记录回调 query。

## 验证

`core/tests/oidc-login.test.js` 用本地生成的 RSA 签名验证 ID Token，覆盖错误签名/issuer/audience/nonce/azp、过期令牌、state/cookie绑定、跨提供方回调、一次性交接、Origin 校验、自动建用户、重复登录、禁用和关闭注册。

外部登录端点在流程测试中使用桩。没有真实 Google Client ID/Secret 与公网回调配置，因此尚未做真实 Google/第三方端到端登录验证。部署后应先用测试用户完整走一遍登录与账号隔离。

## 提供方兼容配置

`OIDC_SCOPES` 默认 `openid profile`，需要邮箱时可显式配置 `openid profile email`。`OIDC_PKCE` 默认 `true`，仅通用 OIDC 可设置 `false`。`OIDC_TOKEN_AUTH_METHOD` 默认 `auto`，可显式选 `client_secret_post` 或 `client_secret_basic`，所选方法必须由 discovery 声明支持；不会自动降级到无密钥鉴权。Google 保持默认 PKCE。
