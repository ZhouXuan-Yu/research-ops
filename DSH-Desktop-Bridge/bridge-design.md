# DSH Desktop 桥：最小设计（v1）

目标：把桌面版 DSH 接进 Hana，成一个 App 的两个面。工具面，让 Agent 能直接下发任务并读回结论；界面面，让用户有一块独立页面看和操作它，用的是同一个实例，因此它的 Bot 与插件全部随页面过来。

整理日期：2026-10-13。本文是设计，不含实现。

## 1. 范围

**做**：一个 App，交出两个面。

- 工具面：暴露一个模型可见的工具，六个动作（list / create / selectModel / prompt / page / cancel），打向桌面实例的 RPC。
- 界面面：一张卡片，取出可成独立窗口，内容是桌面 DSH 的 Web UI，经宿主同源路由供出。

**最小版明确不做**：

- 实时进度流。需要"流载体"，其线协议未读出（见 rpc-contract.md 第 9.1 节）。
- 审批应答。审批是入站请求的返回值，纯 POST 应答不了（第 9.2 节）。
- 数据迁移与共享数据目录。不搬 session，不动 `harness` 目录。
- 桌面侧任何改动。不改它的配置、不装它的补丁、不重启它。

**硬约束**：桌面 DSH 必须继续独立可用；桥只读它的凭证，不写它的数据。

## 2. 平台事实（已核对）

| 事实 | 来源 |
|---|---|
| Hana UI 与卡片宿主跑在 `http://127.0.0.1:14500` | 实测（卡片自报 `location.origin`） |
| 卡片沙箱 CSP 拦截 `frame-src` 指向 `127.0.0.1:43129` | 实测（`securitypolicyviolation` 事件） |
| 卡片沙箱**同样**拦截同源 iframe：`frame-src` 连 `http://127.0.0.1:14500` 都不放行 | 实测（同一监听，两个 iframe 均报拦截） |
| 普通卡片**没有网络**：脚本里发 fetch 的卡片在 smoke 阶段被网络门禁拦下，直接不渲染 | 实测（`Interactive Card smoke failed (network)`） |
| 宿主扩展 API 需凭证：命令行直连 `GET /api/extensions` 返回 403 `missing_credential` | 实测 |
| DSH 服务端**不**禁止被嵌：200 响应无 X-Frame-Options、无 CSP、无 CSP meta | 实测 |
| App 形制：`manifest.json`（capabilities / contributes.cards / settings）+ 入口 `bin/app.mjs` + `ui/*.html`；路由挂在 `/api/apps/<appId>/routes/<route>` | 读自已安装的 DSHana 包与手册 |
| 安装/升级走宿主扩展 API（DSHana 的升级即先 `DELETE /api/extensions/app:dshana` 再提交新包并确认） | DSHana 手册 |
| 桌面端口与 token：每次启动重选，写在 `%APPDATA%\dsh-desktop\logs\harness.log` | 实测日志 |
| 鉴权：token 换 30 天 cookie（`HttpOnly; SameSite=Strict; Path=/`），cookie 名含 authority 哈希 | 实测响应头 |

DSHana 的本地安装脚本（`pnpm run install:local`）属于它自己的仓库，不是通用脚手架。**这一版 Hana 是否另有 App 脚手架，我没有验证**，属于未决项。

## 3. 架构

一个 App（暂名 `dshdesk`），四个部件。

```
manifest.json      声明：capabilities、contributes.cards、settings
bin/app.mjs        server 侧：token 解析 → RPC 客户端 → relay → 工具注册
ui/card.html       卡片面：同源 iframe 指向 relay 出来的 DSH 首页
ui/settings.html   设置面：token / 端口、探测状态、手动刷新
```

**工具面六个动作**（参数名按端点而异，只有 `session/list` 用 `_request`）：

| 动作 | 端点 | 参数名 | 关键字段 |
|---|---|---|---|
| list | `session/list` | `_request` | `{cursor?}` |
| create | `session/create` | `request` | `{cwd?, workspaceId?, sessionId?, agentPreset?}` |
| selectModel | `session/selectModel` | `request` | `{sessionId, provider, model, reasoningEffort?}` |
| prompt | `session/prompt` | `request` | `{requestId, sessionId, mode:"queue"\|"steer", content:[{type:"text",text}]}` |
| page | `session/page` | `request` | `{address:{kind:"session",sessionId}, throughSeq, maxMessages?}` |
| cancel | `session/cancel` | `request` | `{sessionId}` |

`list`、`create`、`selectModel`、`prompt`、`page` 已实测通过；`cancel` 只读契约。

**设计约束（来自实测坑）**：工具面的 `open` 必须串联 `create` + `selectModel` + `prompt`。跳过 `selectModel` 会继承桌面默认模型，而默认模型在当前组合里没有适配器，第一轮以 `NO_ADAPTER` 收场，且事件流里只有 `assistant/attempt` 与 `turn/end`，表现得像"没反应"。

## 4. 关键设计决策

### 4.1 token 获取：三级降级，逐级可用

桌面 token 每次启动轮换，桥必须能稳定拿到它。三级策略，按可用性从高到低，前两级未验证：

1. **解析日志**。读 `%APPDATA%\dsh-desktop\logs\harness.log` 里最后一条 `dsh web: http://127.0.0.1:<port>/?token=<t>`。需要 App 能读自己目录之外的文件，**未验证**。
2. **宿主资源接口**。走 App 的 `app/resources.read` 能力读同一路径，**未验证**。
3. **设置页手填**。用户在设置页粘一次 token 或整条 cookie。零依赖，一定有得用。

三级都可用时，桥在每轮 RPC 前检查 cookie 是否仍有效（发一次 `session/list` 探活），失效则逐级回溯。

### 4.2 cookie 的持有

token 换到的 cookie 是唯一凭证，有效期 30 天，但**跨 DSH 重启是否仍有效未验证**（取决于签名密钥是否持久化）。因此桥不能假定 30 天，按"可能每次重启失效"设计：探活失败即重新走 4.1。

cookie 落在 App 私有数据目录，不做多份拷贝，不进会话文件，不写进卡片 HTML。

### 4.3 relay：本设计里最容易翻车的部分

卡片不能直接 iframe 到 `127.0.0.1:43129`（CSP 拦 `frame-src`），所以由 App 把 DSH 的内容从宿主同源路由供出：

```
用户浏览器 ──同源──> /api/apps/dshdesk/r/<path> ──App server 转发──> 127.0.0.1:43129/<path>
```

要处理的东西，按风险排序：

1. **绝对路径改写**。DSH 页面里是 `/assets/index-xxx.js`、`/api/session/list` 这类绝对路径，经同源路由供出后这些会打到 Hana 宿主上。做法是在转发 index.html 时改写为 `/api/apps/dshdesk/r/...`，并注入一段小脚本不改写运行时生成的 URL（`fetch`、`WebSocket`、`EventSource` 的基址）。这一条做不干净，页面会白屏。
2. **重定向与 Set-Cookie**。`302/303` 的 `Location` 要改写前缀；`Set-Cookie` 的 `Path` 要相应改写，否则 cookie 落到错误路径。
3. **压缩与长度**。转发时要正确处理 `Content-Encoding`（解压后改写，或原样透传并保留头），改写后必须重算或去掉 `Content-Length`。
4. **长连接透传**。`text/event-stream` 与 WebSocket 升级要字节级透传，**不解析**流载体的协议。这是这条路线的价值所在：relay 只要转发，不必理解载体。
5. **前缀与鉴权**。relay 路由本身要走宿主的 surface 授权，不能让任意页面白拿。

### 4.4 卡片面：只能注入，且必须由 App 提供

设计前置假设已被实测推翻，改后如下。

**iframe 路线整体作废**。卡片沙箱的 `frame-src` 不只拦外部地址，连同源 `127.0.0.1:14500` 也拦。所以无论跨源还是同源，iframe 都嵌不进来。DSHana 之所以用同文档注入而不是 iframe，原因就在这里，这一点现在有了直接证据。

**普通卡片承担不了这个面**。普通卡片没有网络：脚本里发 fetch 会被 smoke 门禁拦下，卡片根本不渲染。所以卡片面不能是一张普通的聊天卡片，必须是 App 提供的路由页面，由 App 的 `app/runtime.network` 能力去访问 `127.0.0.1`。

**于是路径只剩一条**：App server 侧 relay 取回 DSH 的页面与资源，卡片页面把这些内容**注入自己的文档**（不是套 iframe），并接管 DSH 前端的相对/绝对地址与长连接。这正是 DSHana 的做法。工作量比原计划大：原计划只需要一个同源 iframe，现在要处理前端注入与地址接管。

### 4.5 不依赖流：进度用拉取

工具面 `open` 建完会话立刻返回 `sessionId`，不算等待。进度由调用方按需 `session/list` + `session/page` 拉取。这与"不做实时进度流"的边界一致，也避免了流载体。

### 4.6 写入可见

工具面的 `create` / `prompt` / `cancel` 会在用户环境里产生真实动作。设计上要求：每次写操作在卡片上留一条 `card.track` 记录（动作、会话、文本前若干字），用户打开卡片就能看到桥替他做过什么。`track` 是静默日志，不进对话、不吵醒 Agent。

## 5. 能力声明（manifest 草案）

参考 DSHana 已声明的词汇：

```json
{
  "capabilities": [
    "app/tools.expose-to-model",
    "app/tasks.manage",
    "app/runtime.network",
    "app/runtime.local-machine"
  ],
  "network": { "allowedHosts": ["127.0.0.1"], "methods": ["GET", "POST"], "allowLocalhost": true }
}
```

`app/models.infer` 不需要，桥不做推理。`app/resources.read` 视 4.1 第二级是否可用再定。

## 6. 分期与验收

| 期 | 内容 | 验收标准 | 回滚 |
|---|---|---|---|
| P0 | App 骨架：manifest + server relay + 卡片页，把 DSH 页面注入卡片 | 卡片里能看到工作台与 Bot 列表，可点击切换会话 | 卸载 App |
| P1 | 工具面只读：`list`、`page` | 在会话里调用工具，拿到会话列表与某会话的结论原文 | 卸载 App |
| P2 | 工具面写入：`create` + `selectModel` + `prompt`、`cancel` | 一次完整闭环，且不依赖桌面默认模型 | 卸载 App |
| P3 | 设置页、token 自动刷新、错误文案 | token 失效后能自动恢复，不要求用户重装 | 卸载 App |

每期都不动桌面侧，所以回滚只需卸载这个 App。P0 之前先做一次**只读实验**：确认宿主 CSP 对同源 iframe 与 `connect-src` 的实际约束（见第 8 节）。

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| relay 路径改写不彻底 | 卡片白屏，整体不可用 | P0 先只做首页与静态资源，逐个补齐；必要时退到注入方案 |
| cookie 跨重启失效 | 用户每次重启桌面都要补 token | 探活 + 三级降级；设置页给一键刷新 |
| App 读不到 App 目录外文件 | token 无法自动化 | 退到设置页手填，功能不受损只损体验 |
| 桌面升级改路由或鉴权形状 | 桥失效 | 契约文档已固化，出问题按文档比对新响应头 |
| 卡片宿主 CSP 还有别的限制 | iframe 方案不可行 | 先做第 8 节的两项实测再开工 P0 |

## 8. 开工前的实测（已执行，结果如下）

| 实测 | 结果 | 对方案的影响 |
|---|---|---|
| 卡片内同源 iframe | **被拦**，`frame-src` 不放行 `127.0.0.1:14500` | iframe 路线作废，必须走注入 |
| 普通卡片能否发网络请求 | **不能**，smoke 门禁拦截，卡片不渲染 | 卡片面必须由 App 提供 |
| 宿主扩展 API 直连 | 403 `missing_credential` | 安装只能走平台入口（扩展管理工具或 Hana 界面），不能绕底层 |
| App server 能否读 App 目录外文件 | **仍未验证**，需 App 骨架存在后才能测 | token 获取暂按"可降级到设置页手填"设计 |

前两项已经改变了方案形态，第三项确认了交付通道，第四项保留为待验。

## 9. 需要你批准的事项

1. 开发和安装这个 App。安装属高权限动作，按你的规矩需单独确认，且我要先给出回滚方式（卸载 App 即可）。
2. 是否允许桥读取 `harness.log` 以自动取 token。若不允许，就固定走设置页手填。

## 10. 已知不做但用户可能追问的能力

- 让 Agent 实时看到 DSH 的推理过程：需要流载体。
- 让 Agent 在 DSH 里放行越权操作：需要那条入站通道。若这两项成为硬需求，方案要从"薄壳"升级为"自带通道的桥"，量级与 DSHana 同级。
