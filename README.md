# QQ Farm · 多用户农场面板

本仓库地址：**https://github.com/maoaceo/qq-farm**

提供普通注册、Google / OIDC / 妖火登录、Turnstile 注册验证及 SQLite 用户存储。**所有用户（包括管理员）只能查看和管理自己的游戏账号。**

> 首次运行的管理员账号为 `admin`，密码为 `admin`。请先修改密码，再开放网站。使用游戏自动化可能违反游戏服务条款并带来账号风险。

## 1. Docker 部署（推荐）

准备 Git、Docker 和 Docker Compose 插件。首次部署：

```bash
git clone https://github.com/maoaceo/qq-farm.git
cd qq-farm
cp .env.example .env
```

编辑本地 `.env`，至少确认以下配置：

```dotenv
PORT=3007
TZ=Asia/Shanghai
LOCAL_REGISTRATION_ENABLED=true
AUTH_PUBLIC_URL=https://farm.xaitr.com
```

将 `AUTH_PUBLIC_URL` 改为你实际使用的 HTTPS 网站原点，不要包含路径。仅在本机试运行且不使用第三方登录时，可以先留空。生产环境建议配置此值，以便 Turnstile 核对域名。

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 qq-farm-bot
```

本机访问 `http://localhost:3007`。远程访问使用服务器地址与端口；正式对外服务请配置 HTTPS 反向代理，并限制后端端口的公网访问。

> Compose 默认使用固定容器名 `qq-farm-bot` 及固定数据卷名 `qq-farm-data`、`qq-farm-logs`。同一台机器不要不经检查部署多个实例，否则会出现名称冲突或共用数据。

## 2. 管理员和普通注册

1. 使用 `admin` / `admin` 登录，进入「设置 → 系统设置」修改密码，随后重新登录。
2. 普通用户在登录页点击 **「没有账号？普通注册」**，填写用户名、密码及确认密码。
3. 注册成功后自动登录为普通用户，初始没有任何游戏账号。
4. 管理员在「用户管理」中可以创建、禁用、启用用户和重置密码。

普通注册默认开启。关闭时在 `.env` 设置：

```dotenv
LOCAL_REGISTRATION_ENABLED=false
```

环境变量修改后执行 `docker compose up -d --build`；仅重启旧容器不能保证载入新的环境变量。

### 游戏账号隔离

- 游戏账号列表、设置中的账号管理、操作接口、日志和实时订阅都只允许访问自己的账号。
- **管理员也不能查看、操作或转移其他用户的游戏账号。**
- 管理员的用户管理与系统设置属于平台权限，不等于游戏账号访问权限。
- 游戏账号使用 `ownerId` 标记归属；历史数据缺少该字段时默认属于管理员。本项目不会根据备注或 QQ 号猜测、改写已有账号归属。
- 这属于应用层隔离，不等于抵御有服务器文件权限的人。管理员仍有重置面板用户密码的权限，必须信任平台管理人员。

## 3. 注册 Turnstile 人机验证

管理员进入 **「用户管理 → 注册人机验证 · Cloudflare Turnstile」**：

1. 在 Cloudflare 创建 Turnstile 组件，允许实际网站域名，例如 `farm.xaitr.com`。
2. 填写 **Site Key** 和 **Secret Key**。
3. 勾选启用并保存，无需重启服务。

Secret Key 保存后不回显，留空保存会保留原密钥。开启后后端必须验证通过才允许普通注册，过期、失败或超时均不放行；不影响密码登录、第三方登录及管理员创建用户。

详细配置见 [Turnstile 教程](docs/turnstile.md)。

## 4. 妖火注册 / 登录

先向妖火管理员申请 **OIDC 机密 Web 客户端**，登记精确回调地址：

```text
https://farm.xaitr.com/api/oauth/oidc/callback
```

服务器本地 `.env`：

```dotenv
AUTH_PUBLIC_URL=https://farm.xaitr.com
OIDC_AUTO_REGISTER=true
OIDC_NAME=妖火
OIDC_ISSUER=https://yaohuo.me
OIDC_CLIENT_ID=填写妖火分配的ID
OIDC_CLIENT_SECRET=填写妖火分配的密钥
OIDC_SCOPES=openid profile
OIDC_TOKEN_AUTH_METHOD=client_secret_post
OIDC_PKCE=false
```

按妖火机密客户端文档设置；Google 默认 PKCE 不受此开关影响。保存后重建容器。登录页会显示 **「使用 妖火 注册 / 登录」**，首次成功认证后自动创建普通用户。

详细步骤见 [妖火接入教程](docs/yaohuo.md)。**密钥只放服务器，不要提交 GitHub，也不要发到公开聊天。**

## 5. Google / 其他 OIDC

Google Cloud 创建 Web 应用 OAuth 客户端，回调：

```text
https://你的域名/api/oauth/google/callback
```

```dotenv
AUTH_PUBLIC_URL=https://你的域名
OIDC_AUTO_REGISTER=true
GOOGLE_CLIENT_ID=你的客户端ID
GOOGLE_CLIENT_SECRET=你的客户端密钥
```

通用 OIDC 和 Google 可以同时启用，但当前仅支持一个通用 OIDC issuer。认证后按验证过的 `(issuer, subject)` 识别用户，不按同名邮箱自动合并账号。

完整配置及限制见 [OAuth / OIDC 教程](docs/oauth-oidc.md)。

### 第三方按钮没有显示？

访问你的网站 `/api/oauth/providers`：

- `{"ok":true,"data":[]}`：没有启用任何第三方提供方；检查环境变量及容器是否重建。
- 列表包含 `google` 或 `oidc`：前端应显示对应入口；强制刷新，确认部署了本仓库最新代码。
- 配置错误：检查 `AUTH_PUBLIC_URL`、issuer、Client ID / Secret 和提供方要求。

## 6. 添加自己的游戏账号

面板用户登录和 QQ / 微信游戏账号登录是两件不同的事。先进入自己的面板用户，再在账号管理中添加自己的游戏账号，可配置种植、好友、自动化策略并启停。

QQ 扫码游戏登录仍依赖单独部署的 [qq-miniapp-auth](https://github.com/liyangpengs/qq-miniapp-auth) 服务。管理员需在系统登录设置中配置对应服务地址和接口签名，才可启用该游戏登录方式；这不是面板的 Google / OIDC 登录。

## 7. 更新现有部署

**先停服并完整备份数据卷，再更新，尤其是首次升级到 SQLite。**

```bash
cd qq-farm
docker compose stop
# 此时备份实际使用的数据卷，确认备份成功后继续
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 qq-farm-bot
```

如本地有代码修改导致拉取失败，先保存改动再处理，不要直接运行 `git reset --hard`。不要在更新时重新覆盖现有 `.env`。

> **禁止为“更新”执行 `docker compose down -v`，这会删除数据卷。**

### SQLite 自动迁移

普通用户、密码哈希及第三方身份绑定存入 `users.sqlite`。旧 `users.json` 首次自动迁移，保留用户 ID、密码哈希和绑定，并创建 `users.json.pre-sqlite.bak`。存在迁移冲突时中止，不会默默清空用户。

- 普通用户：`core/data/users.sqlite`
- 管理员：`core/data/admin.json`
- 游戏账号和归属：`core/data/accounts.json`
- Turnstile 密钥：`core/data/turnstile.json`
- Docker 中对应目录为 `/app/core/data`，使用持久化数据卷。

SQLite 开启 WAL，备份时建议停服后复制整个数据目录，包含存在的 `-wal` / `-shm` 文件。**旧 JSON 不会同步新用户或改密结果，升级后不要直接回滚旧代码。**

更多迁移与备份边界见 [SQLite 用户存储教程](docs/sqlite-users.md)。

## 8. 源码运行

需要 Node.js 20.19+、pnpm 10.30.2，以及 SQLite 原生模块所需的编译环境（无预编译包时需要 Python 3、make、C++ 编译器）。

```bash
git clone https://github.com/maoaceo/qq-farm.git
cd qq-farm
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm -C core start
```

源码启动**不会自动读取根目录 `.env`**。通过 shell 环境变量、systemd EnvironmentFile 或你的进程管理器安全地注入配置，再启动服务。仅复制 Docker 的 `.env` 文件并不能让源码运行读取它。

SQLite 原生依赖需在目标系统架构和 Node 版本下安装，不要直接复制其他平台的 `node_modules`。目前建议使用源码或 Docker，原先 Node18 `pkg` 单文件发布流程未验证 SQLite 动态库打包，不作为本版本推荐教程。

## 9. 验证与限制

```bash
pnpm -C core typecheck
pnpm typecheck:web
pnpm build
pnpm -C core test
pnpm -C web test
```

最近一次代码验证为 **293 项后端、15 项前端测试通过**，详见 [验证记录](VALIDATION.txt)。外部认证和 Turnstile 在流程测试中使用模拟服务，不代表已验证你部署环境的真实账号、密钥和网络。Dockerfile 已适配 SQLite 编译，但未在当前开发设备实际构建 Docker 镜像。

登录会话目前保存在内存，重启后需要重新登录。并发游戏账号能力取决于机器资源及上游限制，不承诺无限运行规模。请做好 HTTPS、数据目录权限、备份、日志脱敏和防滥用措施。

## 文档与致谢

- [配置教程目录](docs/README.md)
- [多用户使用说明](docs/multiuser.md)
- [SQLite 与严格账号隔离](docs/sqlite-users.md)
- [普通注册 Turnstile](docs/turnstile.md)
- [Google / OIDC](docs/oauth-oidc.md)
- [妖火](docs/yaohuo.md)

项目基于 [liyangpengs/qq-farm-bot](https://github.com/liyangpengs/qq-farm-bot) 改造，感谢上游贡献。本 README 已替换为本仓库教程，不再沿用原项目部署教程及旧截图；保留来源说明、许可证和底层技术参考，不改变原作者署名与许可要求。
