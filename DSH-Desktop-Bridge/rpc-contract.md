# 桌面端 DSH RPC 契约（实测整理 v2）

对象：DSH Desktop 0.11.1，内核 `@deepseek-ai/dsh` 0.2.0-rc.2，服务地址 `http://127.0.0.1:43129`（端口由桌面启动器每次启动指定）。
用途：给"把桌面 DSH 接入 Hana"的桥（App）提供直接可用的请求格式。
整理日期：2026-10-13。v2 修订了 v1 中两处错误：参数名（只有 `session/list` 用 `_request`）与端点名（`session/modelCatalog`、`session/selectModel`）。

## 0. 证据等级

| 结论 | 等级 |
|---|---|
| 传输、信封、payload 形状，各方法参数与结果 schema | 读自它自己的客户端 bundle（`dsh-api-gateway` + typert 描述符） |
| `session/list`、`session/page` | **已实证** |
| `session/create`、`session/selectModel`、`session/prompt` | **已实证**，且已完成一次完整的建会话到读回回复 |
| `session/cancel` | 仅读契约，未执行 |
| 新建会话的默认模型会失败 | **已实证**（`NO_ADAPTER`，见第 5 节） |
| cookie 跨 DSH 重启是否仍有效 | **未知**，取决于签名密钥是否持久化 |
| 12 个流式端点、审批链路的契约 | 已读，见第 9 节；流的实际载体尚未实测定位 |

## 1. 地址与鉴权

桌面端每次启动重选端口并生成新 token，两者都写在 `%APPDATA%\dsh-desktop\logs\harness.log`：

```
[desktop] endpoint http://127.0.0.1:43129
dsh web: http://127.0.0.1:43129/?token=<每次不同>
```

鉴权是 cookie。带 token 请求一次根路径，得到 303 与一条 `Set-Cookie`：

```
set-cookie: dsh-auth-<authority-hash>=v1.<payload>.<sig>; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict
```

payload 是 base64 的 `{"version":1,"authority":"127.0.0.1:43129","issuedAt":...,"expiresAt":...}`。
cookie 名里带 authority 哈希，换端口就是另一个 cookie；`SameSite=Strict` 要求嵌入页与它同站，`127.0.0.1` 上不同端口属同站；有效期 30 天，跨重启是否有效未验证。

## 2. 传输与信封

```
POST {BASE}/api/{endpoint}
content-type: application/json
cookie: <上面那条>

{"type":"client-request","rpcId":"<任意唯一串>","method":"{endpoint}","payload":{"args":{...}}}
```

响应：

```json
{"type":"server-response","rpcId":"<回显>","result":{"ok":true,"value":{...}}}
{"type":"server-response","rpcId":"<回显>","result":{"ok":false,"error":{"code":"...","message":"...","details":{...}}}}
```

`payload` 只含一个 `args` 字段；`args` 里是该方法声明的参数。

## 3. 坑一：参数名按端点而异

`args` 里的参数名取自描述符的 `parameters[].name`，各端点不同。实测五个端点里只有 `session/list` 用 `_request`，其余都是 `request`：

| 端点 | 参数名 |
|---|---|
| `session/list` | `_request` |
| `session/create` | `request` |
| `session/selectModel` | `request` |
| `session/prompt` | `request` |
| `session/page` | `request` |
| `session/cancel` | `request` |

用错的报错形如：

```
gateway/arguments-invalid: session/page: args fields do not match the descriptor: missing "request"; unexpected "_request"
```

桥的实现应当把描述符读进来按名字填，不要硬编码。

## 4. 坑二：新建会话的默认模型跑不通

实测第一次建会话时，`session/create` 成功，`session/prompt` 也返回 `accepted:true`，但整轮以错误收尾：

```
turn/end: {"turn":1,"reason":{"kind":"error","error":{"message":"no adapter registered for provider \"opencode2dsh\"","code":"NO_ADAPTER"}}}
```

原因是新建会话继承了默认模型 `opencode2dsh/nemotron-3.5-lightning-free`，而当前组合里没有为 `opencode2dsh` 注册适配器。表现很隐蔽：只有 `assistant/attempt` 与 `turn/end`，没有 `assistant/message`。

**所以桥建完会话必须显式调 `session/selectModel`**，指定一个真的有适配器的路由（实测 `deepseek-official` / `deepseek-flash` 可用）。或者去修桌面的默认模型设置。

## 5. 六个动作的请求原文

### 5.1 list（列会话）

```
POST /api/session/list
{"type":"client-request","rpcId":"r1","method":"session/list","payload":{"args":{"_request":{}}}}
```

参数 schema `{ cursor?: string }`。结果 `items[]` 每项含 `sessionId`、`cwd`、`running`、`blank`、`updatedAt`、`agentAvailable`、`projections`；`projections.asOfSeq` 是 `page` 需要的读取位点，`projections.values.title` 是标题。

### 5.2 create（建会话）

```
POST /api/session/create
{"type":"client-request","rpcId":"r2","method":"session/create","payload":{"args":{"request":{"cwd":"C:\\Users\\ZhouXuan\\Documents\\deepseek-harness-default-workspace"}}}}
```

参数 schema：`{ workspaceId?, cwd?, sessionId?, agentPreset? }`，**没有模型字段**。
结果：`{ sessionId, agentPreset? }`。实测返回 `{"sessionId":"session-adf9862d-...","agentPreset":"standard"}`。

### 5.3 selectModel（建会话后必做）

```
POST /api/session/selectModel
{"type":"client-request","rpcId":"r3","method":"session/selectModel","payload":{"args":{"request":{"sessionId":"session-<uuid>","provider":"deepseek-official","model":"deepseek-flash"}}}}
```

参数 schema：`{ sessionId, provider, model, reasoningEffort? }`。
结果：`{ selected: { provider, model, reasoningEffort? } }`。实测返回 `{"selected":{"provider":"deepseek-official","model":"deepseek-flash","reasoningEffort":"high"}}`。

可用路由与模型可用 `session/modelCatalog` 查询（无参数）。

### 5.4 prompt（投提示词）

```
POST /api/session/prompt
{"type":"client-request","rpcId":"r4","method":"session/prompt","payload":{"args":{"request":{
  "requestId":"<唯一串>","sessionId":"session-<uuid>","mode":"queue",
  "content":[{"type":"text","text":"你好"}]
}}}}
```

参数 schema：

```
requestId: string        # 必填，客户端自生成，用于关联
sessionId: string        # 必填
mode: "queue" | "steer"  # 必填；steer 相当于"下一输入点贴回"，queue 相当于"另起一轮"
content: Array<
    { type: "text",  text: string }
  | { type: "image", mediaType: "image/png"|"image/jpeg"|"image/webp"|"image/gif", data: string, name?: string }
  | { type: "file",  receiptId: string }
>
clientTimeZone?: string
```

结果：`{ accepted: true }`，只表示受理。

### 5.5 page（读回记录）

```
POST /api/session/page
{"type":"client-request","rpcId":"r5","method":"session/page","payload":{"args":{"request":{
  "address":{"kind":"session","sessionId":"session-<uuid>"},
  "throughSeq": 22,
  "maxMessages": 40
}}}}
```

参数 schema：

```
address:
    { kind: "session",  sessionId: string }
  | { kind: "subagent", parentSessionId: string, childSessionId: string,
      mode: "one-shot" | "continuable" | "unknown" }
throughSeq: number       # 必填；取 session/list 的 projections.asOfSeq
beforeSeq?: number
maxMessages?: number
turnWindow?: { minMessages: number, minTurns: number }
```

结果 `records[]`，每项 `{ "type": "event", "event": { type, seq, time, data } }`。实测见到的事件类型：`user/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、`step/start`、`step/end`、`turn/start`、`turn/end`、`request/header`、`request/context`、`session/title`、`session/title-llm-request`、`session-log-deepseek/delivery-accepted`、`permission/preset`、`sandbox/mode`、`approval/policy`、`agent/inbox/spliced`、`system/message`。

### 5.6 cancel（取消在跑的任务）

```
POST /api/session/cancel
{"type":"client-request","rpcId":"r6","method":"session/cancel","payload":{"args":{"request":{"sessionId":"session-<uuid>"}}}}
```

参数 schema `{ sessionId: string }`，结果 `{ accepted: true }`。未执行验证。

### 5.7 直接可跑的形式

PowerShell 一行版（前两条已实证）：

```powershell
$b='http://127.0.0.1:43129'; $c='dsh-auth-xxxx=v1.yyyy'
curl.exe -s -X POST -H "content-type: application/json" -H "cookie: $c" -d '{"type":"client-request","rpcId":"r1","method":"session/list","payload":{"args":{"_request":{}}}}' "$b/api/session/list"
```

```powershell
curl.exe -s -X POST -H "content-type: application/json" -H "cookie: $c" -d '{"type":"client-request","rpcId":"r2","method":"session/page","payload":{"args":{"request":{"address":{"kind":"session","sessionId":"session-xxxx"},"throughSeq":22,"maxMessages":40}}}}' "$b/api/session/page"
```

Node 版本见同目录 `dsh-rpc.mjs`，六个动作与结论提取都封装为函数。

## 6. 取"这一轮结论"的规则

`assistant/message` 事件形状（实测样本）：

```json
{"type":"assistant/message","seq":722,"time":1791878366970,
 "data":{"turn":8,"step":3,
   "message":{"role":"assistant",
     "content":[{"type":"reasoning","text":"..."},{"type":"text","text":"..."}],
     "source":{"kind":"model","provider":"deepseek-official","model":"deepseek-flash"}}}}
```

规则：在 `records` 里找最后一个 `user/message` 之后最后一条 `assistant/message`，取 `data.message.content` 里 `type === "text"` 的项拼起来，跳过 `reasoning`。若这一轮只有 `assistant/attempt` 与 `turn/end`，说明模型或工具报错，错误在 `turn/end.data.reason.error`。

## 7. 端点清单（session 命名空间 20 个）

`attachment` `cancel` `canOpenWorkspacePath` `control` `create` `delete` `follow` `fork` `initializeDefaultModel` `list` `modelCatalog` `openWorkspacePath` `page` `projections` `prompt` `rename` `search` `selectModel` `updateQueue` `workspacePathApplications`

其余命名空间：workspace 10 个（`archive` `create` `delete` `follow` `initialize` `insert` `pin` `rename` `unarchive` `unpin`），terminal 10 个（`close` `create` `environment` `follow` `list` `rename` `resize` `retain` `shells` `write`），job 3 个（`follow` `kill` `list`）。

## 8. 实证记录

| 会话 | 过程 | 结果 |
|---|---|---|
| `session-75dacb7f-2dea-4df5-b28f-e4172c8fa8cf` | create + prompt（未选模型） | 轮次以 `NO_ADAPTER` 收尾；`prompt` 已 `accepted` |
| `session-adf9862d-62a3-4f75-9237-5ca4cd1a0fda` | create + selectModel + prompt | 完整闭环。回复：`收到，写入路径验证确认无误。` 自动标题：`写入路径验证确认收到` |

两次都用 `Documents\deepseek-harness-default-workspace` 作为 cwd，提示词显式禁止读写文件与执行命令。

## 9. 流式端点与审批链路

### 9.1 流式端点：不是一元 POST

描述符里带 `mode: "stream"` 的端点共 12 个：

```
session/control      session/follow      job/follow      job/list
workspace/follow     terminal/follow     terminal/retain
userQuestions/attachWait   workspaceFiles/changes
account/watch        account/watchExpiry   productAnalytics/watchPolicy
```

`session/follow` 描述符原文：`mode: "stream"`，参数名 `request`，类型 `#SessionFollowRequest`，`cancellation: { parameter: "signal" }`。

客户端代码显示流与一元调用走两条不同的路。一元调用是一条 fetch POST：

```js
async call(channel, endpoint, payload, signal) {
  const message = { type: "client-request", rpcId, method: endpoint, payload };
  const response = await send(`${channel}/${endpoint}`.slice(1), { method: "POST", ... });
```

而流的载体是工厂的第二个参数，注释原文为 `@param openStream - optional worker-local Gateway stream carrier`，即流交给一个"Gateway 流载体"，不是普通 fetch。

**实测一**：对 `session/control` 发普通 POST，服务端直接拒绝：

```
gateway/signature-invalid: typert gateway: session/control: stream Remote methods must be opened through the stream carrier
```

即流式端点**不能**用一元 POST 打开。

**实测二**：`/plugins/events` 响应头是 `text/event-stream; no-cache`，确实是 SSE，但它属于 `dsh-client-hmr`（插件热更新通道），不是会话事件流。

**对桥的含义**：工具面六个动作（`list` `create` `selectModel` `prompt` `page` `cancel`）全部是一元端点，不需要流载体。只有"实时进度"与"审批应答"需要它。

### 9.2 审批链路：答案是入站请求的返回值

来源是审批 UI 插件自己的客户端代码，原文：

```js
ctx.remote.$on("approval/request", function(request, next) {
  return answerApproval(ctx, this, request, next, registerPendingInteraction);
});
```

由 `answerApproval` 的实参可见，审批是一个**入站的远程请求**，答案由处理器的**返回值**带回，不是另发一个 POST。它内部构造一个 `PendingApproval`（字段：`toolName`、`callId`、`reason`、`displayReason`、`signal`），等界面上的审批面板作出决定后 resolve，把这个决定当作返回值交回去。

端点层面没有找到审批专属入口：typert 注册表 136 个端点里，与"应答"相关只有 `userQuestions/answer`、`userQuestions/attachWait`、`goals/resume`、`session/control`；全域搜 `approvalId` 无结果，只有插件运行状态里的 `approvalRequestId`。`session/control` 是流且无参数，结果类型 `SessionControlFrame`，属服务端到客户端方向。

**推断（前述实验已使其更强）**：能否应答审批，取决于是否握有那条入站请求的返回通道。既然流式端点已被实测排除在一元 POST 之外，而审批又是入站请求的返回值，纯 POST 的桥很可能做不到替人放行。若成立，这就解释了 DSHana 为什么必须自己托管一整套运行时：它需要那条控制面通道。这是推断，不是已验证结论。

顺带一提，`userQuestions/answer` 的存在说明 DSH 确实有一元形式的"应答"先例，审批是否也能走类似形式，值得下一步实测。

## 10. 未验证项

1. `session/cancel` 未执行。
2. cookie 跨 DSH 重启是否仍有效未验证，未知则桥需在重启后重取 token。
3. 流式端点的实际网络载体未定位（第 9.1 节）。
4. 审批能否用一元端点应答未实测（第 9.2 节，含推断）。
5. 附件上传、`session/fork`、`session/updateQueue`、`session/projections` 未读。
