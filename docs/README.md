# 使用教程目录

本版本仓库：<https://github.com/maoaceo/qq-farm>。请以[仓库首页部署教程](../README.md)为入口，不要使用上游旧版的单管理员部署说明。

## 部署与账户

| 教程 | 内容 |
| --- | --- |
| [首页完整教程](../README.md) | Docker 首次安装、更新、普通注册、源码运行 |
| [多用户说明](multiuser.md) | 用户权限、账号归属、普通注册 |
| [SQLite 用户存储](sqlite-users.md) | 自动迁移、备份、严格管理员隔离 |
| [Turnstile 人机验证](turnstile.md) | 管理员后台 Site Key / Secret Key 配置 |
| [Google / 通用 OIDC](oauth-oidc.md) | 第三方登录注册、回调地址、环境变量 |
| [妖火登录](yaohuo.md) | 妖火 OIDC 客户端申请与部署配置 |

管理员和普通用户的游戏账号严格隔离。管理员不能查看或管理其他用户的游戏账号。不要提交 `.env`、数据库、账号文件或验证密钥。

## 底层技术参考

下列文档保留给开发维护使用，不是本版本部署教程。部分内容来自上游，不代表新增功能均经过端到端验证。

- [配置存储与迁移](config-storage.md)
- [网络并发模型](network-concurrency.md)
- [TSDK 运行约定](tsdk-runtime.md)
- [工具脚本](tools.md)
- [游戏资源更新](game-update-20261022.md)
- [微信连接参考](wechat-connection.md)
- [商城协议](shop-protocols.md)
- [好友宠物缓存](friend-pet-cache.md)
- [宠物协议](pet-protocols.md)
- [天气活动](weather-activity.md)

来源及许可说明见[首页致谢](../README.md#文档与致谢)，许可证与原作者署名予以保留。
