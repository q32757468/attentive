# VS Code 窗口上下文 IPC 实施规格

- 状态：实现完成；Unix 自动化通过，Windows/Remote 人工验收待执行
- 日期：2026-08-25
- 决策记录：[ADR-0003](../ADR/0003-vscode-window-context-ipc.md)
- 实现后将取代：[VS Code 窗口回跳规格](VSCODE_WINDOW_CALLBACK_SPEC.md)

## 1. 目的

本规格用于把 ADR-0003 交接给后续实现者。目标是在不修改 Windows Notifier 私有边界的前提下，让 Attentive CLI 在发送通知前，从启动它的 VS Code 窗口主动查询：

- 当前窗口是否聚焦；
- 当前窗口生成的 Callback URI。

窗口聚焦时，CLI 成功抑制通知并且不联系 Notifier。窗口未聚焦时，CLI 使用查询得到的 Callback URI 构造点击动作并照常发送。查询不可用时 fail-open，发送无 VS Code 点击动作的普通通知。

本文记录当前代码的目标实现与已完成的 Unix 自动化验收；Windows named pipe、VS Code Stable 实例和 Remote 环境仍需在对应环境完成端到端验收后，才能扩大正式支持范围。

## 2. 已确认的产品行为

### 2.1 状态语义

唯一用于抑制通知的状态是：

```ts
vscode.window.state.focused
```

不得使用 `WindowState.active` 代替，不得通过窗口标题、编辑器状态或平台私有 API 推测可见、最小化或遮挡状态。

只查询来源终端所属窗口。其他 VS Code 窗口是否聚焦与本次通知无关。

### 2.2 CLI 结果

| 条件 | CLI 行为 | 退出码 | 联系 Notifier | Notification ID |
| --- | --- | ---: | --- | --- |
| `focused=true` | 输出抑制原因 | 0 | 否 | 无 |
| `focused=false` | 发送通知 | 由发送结果决定 | 是 | 成功时有 |
| endpoint 缺失 | 发送普通通知 | 由发送结果决定 | 是 | 成功时有 |
| endpoint 非法 | warning 后发送普通通知 | 由发送结果决定 | 是 | 成功时有 |
| IPC 连接、超时或响应失败 | 静默 fail-open，发送普通通知 | 由发送结果决定 | 是 | 成功时有 |

聚焦抑制时 stdout 使用稳定、可测试的文本：

```text
Notification suppressed: source VS Code window is focused
```

首版不增加 `--force`、配置项、环境开关、查询重试、焦点缓存或状态订阅。

### 2.3 Action 优先级

在需要发送通知时，Action 优先级为：

```text
显式 --url > IPC callbackUri > 无 Action
```

显式 `--url` 不绕过焦点查询。所有显式参数和配置必须先被解析、读取并校验；例如非法 `--url` 必须报错，不能因为窗口聚焦而以抑制成功结束。

## 3. 目标架构

```text
packages/vscode-extension
  ├─ registerUriHandler(/focus)
  ├─ asExternalUri(...) -> callbackUri
  ├─ window.state.focused
  └─ Window Context HTTP server
           │
           │ named pipe 或 Unix domain socket
           │ ATTENTIVE_VSCODE_IPC_ENDPOINT
           ▼
packages/cli
  ├─ 参数与配置校验
  ├─ GET /v1/window-context（总超时 100 ms）
  ├─ focused=true：成功短路
  └─ focused=false/查询失败：构造 NotificationRequest
           │
           ▼
packages/notifier（不修改窗口状态职责）
```

共享的 Window Context wire type 和校验放在 `packages/protocol` 的独立模块中。Notifier 不导入、不读取也不记录窗口上下文。

## 4. Wire contract

### 4.1 Endpoint 环境变量

新变量：

```text
ATTENTIVE_VSCODE_IPC_ENDPOINT=<opaque socket or pipe path>
```

实现时必须：

- 删除扩展 collection 中的 `ATTENTIVE_VSCODE_CALLBACK_URI` contribution；
- 删除 CLI 对 `ATTENTIVE_VSCODE_CALLBACK_URI` 的读取和 fallback；
- 不保留旧 CLI、旧扩展或旧终端的兼容分支；
- 将 collection 的 `persistent` 设为 `false`；
- 只有 IPC server 已成功进入 listening 状态后，才 `replace` 新 endpoint；
- server 启动失败时不得留下声称可用的 endpoint contribution。

环境变量只定位 IPC server，不是稳定窗口 ID，也不作为认证凭据。

### 4.2 HTTP request

```http
GET /v1/window-context HTTP/1.1
Connection: close
```

约束：

- 不发送 request body；
- 不发送 bearer token；
- 只接受 `GET /v1/window-context`；
- 其他路径返回 `404`；
- 正确路径上的其他方法返回 `405`；
- 每次 CLI 查询使用一个短连接，不依赖 keep-alive。

建议在 protocol 中定义：

```ts
export const WINDOW_CONTEXT_VERSION = 1;
export const WINDOW_CONTEXT_PATH = "/v1/window-context";
export const WINDOW_CONTEXT_TIMEOUT_MS = 100;
export const MAX_WINDOW_CONTEXT_RESPONSE_BYTES = 8 * 1024;
```

### 4.3 HTTP response

成功状态为 `200 OK`，`content-type` 为 `application/json`：

```json
{
  "version": 1,
  "focused": false,
  "callbackUri": "vscode://attentive.attentive-vscode/focus?..."
}
```

建议 wire type：

```ts
export interface WindowContextResponse {
  version: 1;
  focused: boolean;
  callbackUri?: string;
}
```

校验规则：

- 顶层必须是 JSON object；
- `version` 必须严格等于 `1`；
- `focused` 必须是 boolean；
- `callbackUri` 可缺失；
- `callbackUri` 存在时必须通过现有受控 URI 校验，且不超过 4096 字符；
- 非法或缺失的 `callbackUri` 只删除该可选字段，不使合法的 `focused` 失效；
- 非法 `version`、非法 `focused`、非 JSON 或超出 8 KiB 使整个查询失败。

protocol 应提供返回“已清洗上下文或失败”的解析函数，避免 CLI 和扩展重复实现边界。例如：

```ts
export function parseWindowContextResponse(
  value: unknown
): WindowContextResponse | undefined;
```

该函数对非法可选 callback 返回不带 `callbackUri` 的合法结果；不要把这种部分降级实现成异常。

## 5. IPC endpoint

### 5.1 平台映射

使用 Node 内置 `node:http`、`node:net`、`node:crypto`、`node:os`、`node:path` 和 `node:fs`，不增加 IPC 第三方依赖。

Windows：

```text
\\.\pipe\attentive-vscode-<128-bit-or-stronger-random-id>-sock
```

Unix、WSL、Dev Container 和 Linux Remote Extension Host：filesystem Unix domain socket。

Unix 目录选择顺序：

1. `XDG_RUNTIME_DIR` 存在、属于当前用户并具有安全权限时使用；
2. 否则在 `os.tmpdir()` 下创建 Attentive 当前用户私有目录，目录权限设为 `0700`；
3. 如果候选路径超过平台安全长度，使用更短文件名或回退到较短的私有临时目录；
4. 不使用 Linux abstract socket，因为它不能统一覆盖 Windows 和 macOS，也会提高 Node 最低版本。

实现必须为 endpoint 生成和目录选择提供依赖注入，使 Linux、macOS 和 Windows 分支能在任一开发平台上单元测试。

### 5.2 生命周期

生命周期严格跟随本次 Extension Host 激活：

1. 生成新的随机 endpoint；
2. 创建 server；
3. 等待 `listening`；
4. Unix 平台把 socket 文件权限收紧为 `0600`；如果无法建立要求的权限，则关闭 server 且不注入 endpoint；
5. 设置持久环境贡献；
6. Extension Host 停用时停止接收连接；
7. 等待已有短连接结束或销毁；
8. 非 Windows 平台 best-effort unlink 本实例拥有的 socket 文件。

只允许复用由本扩展持久 environment contribution 返回、且通过格式、目录所有者和权限校验的 endpoint。不得从 workspace 信息推导地址，也不得看到同名 socket 就直接 unlink；无法重新监听时必须回退到新的随机 endpoint。

普通单窗口重载后，新 Extension Host 必须优先校验并重新监听缓存的 endpoint，使恢复 shell 保持可用。校验或重绑失败时生成新 endpoint，旧 shell 查询失败并 fail-open；新建或重启终端获得新 endpoint 后恢复完整能力。

### 5.3 server 限制

实现必须设置并测试：

- 固定 method 和 path；
- 有限的 HTTP header 大小；
- socket 空闲超时；
- 有限并发连接数；
- `Connection: close`；
- 8 KiB response body 上限；
- 未捕获 handler 错误转换为有限错误响应并记录分类，不泄漏 endpoint 或 callback。

建议的首版并发上限为 32。连接或 handler 应在远短于普通 Notifier 10 秒超时的时间内结束。具体 server-side timeout 可以略高于 CLI 的 100 ms，但不得形成长期连接。

## 6. VS Code 扩展实施

### 6.1 当前改动入口

当前主要文件：

- `packages/vscode-extension/src/callback.ts`
- `packages/vscode-extension/src/extension.ts`
- `packages/vscode-extension/test/callback.test.ts`
- `packages/vscode-extension/package.json`

实现者可以拆分以下职责，避免继续把网络、endpoint 和 VS Code API 全部放入 `callback.ts`：

```text
src/
├─ callback.ts               # /focus URI handler 与 callback URI 生成
├─ ipc-endpoint.ts           # 跨平台随机 endpoint 与 Unix 目录
├─ window-context-server.ts  # HTTP server、路由、限制与 dispose
└─ extension.ts              # 激活编排、环境 contribution、诊断
```

文件名可以调整，但模块边界和可测试性必须保留。

### 6.2 激活顺序

建议顺序：

1. 取得 `environmentVariableCollection`；
2. 设 `persistent = true`，读取并校验缓存的 IPC endpoint；
3. 删除旧 `ATTENTIVE_VSCODE_CALLBACK_URI`；
4. 注册 `/focus` URI handler；
5. 注册或扩展现有诊断命令；
6. 调用 `asExternalUri(CALLBACK_BASE_URI)`；失败时记录诊断，但允许 `callbackUri` 为 `undefined`；
7. 优先在有效缓存 endpoint 上创建 Window Context server，handler 每次请求即时读取 `vscode.window.state.focused`；重绑失败时改用新随机 endpoint；
8. 等待 server listening；
9. 注入 `ATTENTIVE_VSCODE_IPC_ENDPOINT`；
10. 把 server disposer 加入 `context.subscriptions`。

不要缓存 `focused`，也不需要订阅 `onDidChangeWindowState`。读取请求发生时的 `window.state.focused` 即可。

如果 server 启动失败，扩展的 URI handler 和诊断命令仍可工作；IPC contribution 必须缺失，CLI 随后 fail-open。

### 6.3 诊断命令

保留现有 command ID `attentive.showCallbackStatus`，避免无必要的命令身份变更；可以把用户可见标题改为更宽泛的集成状态。

状态至少包含：

- server 是否 listening；
- endpoint 类型：Unix socket 或 named pipe；
- 当前 `focused`；
- callback 是否可用及其 scheme；
- 最近一次 IPC 错误的分类和时间。

不得显示：

- 完整 endpoint；
- 完整 Callback URI；
- HTTP headers 或响应正文；
- workspace、活动文件或终端内容。

### 6.4 VS Code 类型版本

将 `packages/vscode-extension/package.json` 中：

```json
"@types/vscode": "^1.100.0"
```

锁定为项目最低运行时对应的精确 `1.100.0`，或由仓库统一策略锁到 `1.100.x`，不得继续解析到较新的 1.134 类型并误用新 API。

## 7. CLI 实施

### 7.1 当前改动入口

主要文件：

- `packages/cli/src/cli.ts`
- `packages/cli/test/cli.test.ts`

建议新增：

```text
packages/cli/src/window-context-client.ts
packages/cli/test/window-context-client.test.ts
```

窗口查询客户端应与 Notifier 使用的 `fetchImpl` 分离，因为 Node `fetch` 不支持 `socketPath`。使用 `node:http.request({ socketPath })`，并通过依赖注入让 `run()` 单元测试无需真实 socket。

### 7.2 重构执行顺序

当前 `createRequest()` 同时处理显式参数、旧 callback 环境变量和最终协议校验。实现时拆开以下阶段：

1. `parseArgs()`；
2. 解析 metadata、校验 title/body/source/显式 `--url`；
3. `resolveCliConfig()`，确保显式配置错误不会被焦点抑制掩盖；
4. 读取并校验 `ATTENTIVE_VSCODE_IPC_ENDPOINT`；
5. endpoint 合法时查询 Window Context；
6. `focused=true` 时输出抑制信息并返回 0；
7. 否则按 `--url > callbackUri > 无 Action` 构造 `NotificationRequest`；
8. 调用现有 `sendNotification()`。

不得继续读取 `ATTENTIVE_VSCODE_CALLBACK_URI`。

### 7.3 endpoint 校验

在调用 `http.request` 前至少拒绝：

- 空字符串；
- 包含 NUL；
- 明显超过合理 IPC path 上限的值；
- 当前平台无法表示的 endpoint 形式。

格式非法时向 stderr 输出一次稳定 warning，然后发送普通通知。运行期 `ENOENT`、`ECONNREFUSED`、socket reset、HTTP error、超时、超限和响应校验失败保持静默 fail-open。

不要把 endpoint 内容放入 warning 或错误信息。

### 7.4 查询客户端

查询客户端必须：

- 使用固定 `100 ms` 总预算，而不是 CLI 的 `--timeout`；
- 在 timer 到期时销毁 request/socket；
- 只接受 HTTP 200；
- 流式累计 response body，并在超过 8 KiB 时立即销毁；
- 拒绝非 JSON；
- 使用 protocol 的解析函数处理核心失败和可选 callback 降级；
- 在所有完成路径清理 timer 和 listeners；
- 不重试；
- 不打印 endpoint、Callback URI 或原始响应。

建议返回：

```ts
type WindowContextQueryResult =
  | { kind: "available"; context: WindowContextResponse }
  | { kind: "unavailable" }
  | { kind: "invalid-endpoint" };
```

`invalid-endpoint` 由 CLI 打印 warning；`unavailable` 静默 fail-open。

## 8. Protocol 实施

当前入口：

- `packages/protocol/src/index.ts`
- `packages/protocol/test/index.test.ts`

可以新增 `src/window-context.ts` 并从 package root 导出，或先放入 `index.ts`。必须保持 Window Context 与 NotificationRequest 的类型、错误和校验函数逻辑隔离，避免 Notifier 的通知 handler 获得隐式窗口职责。

至少新增：

- Window Context 版本、path、timeout 和大小常量；
- `WindowContextResponse`；
- 对核心字段严格、对 callback 可部分降级的解析函数；
- endpoint 环境变量名称常量可放在扩展/CLI 各自模块，或放在 protocol 的 integration constants 模块；不得复制成可能漂移的字符串。

不得修改 `/api/v1/notifications`、`NotificationRequest`、`CreateNotificationResponse` 或 Notifier 的成功语义。

## 9. Notifier

`packages/notifier` 不需要功能修改。

实现验收必须确认：

- 不新增 `suppressed`、`focused`、`windowContext` 等通知请求字段；
- Notifier 不连接 VS Code IPC；
- 被抑制时 CLI 的 Notifier `fetchImpl` 从未被调用；
- 未抑制时现有 HTTP/Toast 行为保持不变。

## 10. Runtime 和依赖

仓库当前没有 Node 最低版本声明，但 CLI 已依赖全局 `fetch`。实现时：

- 根 `package.json` 声明 `engines.node: ">=18.18"`；
- 需要发布或独立运行的 Node packages 同步声明兼容基线；
- 将 `@types/node` 调整到与 Node 18 基线兼容的版本，避免编译时误用 Node 24-only API；
- 不使用 Linux abstract sockets；
- 不使用 Node 24.2 才稳定的 `server[Symbol.asyncDispose]()`；
- server close 用 Node 18 可用的 callback/Promise 封装；
- 不新增原生模块或平台特定 npm 依赖。

## 11. 自动化测试

### 11.1 Protocol

至少覆盖：

- `focused=true` 和 `focused=false`；
- 合法可选 Callback URI；
- Callback URI 缺失；
- Callback URI 非法时保留合法 focused、移除 callback；
- 非 object、错误 version、缺失或非 boolean focused 时整体失败；
- Callback URI 长度边界。

### 11.2 VS Code extension

至少覆盖：

- collection 设为持久，并覆盖缓存 endpoint 的安全复用；
- 删除旧 callback contribution；
- server listening 前不注入 endpoint；
- listening 后只注入当前 endpoint；
- `/focus` handler 行为保持不变；
- 每个 IPC 请求读取当时的 `window.state.focused`，两次请求之间状态变化能反映；
- callback 生成成功、失败和非法值；
- GET 成功响应；
- 错误 method/path；
- 并发和 idle timeout 限制；
- dispose 关闭 server；
- Unix 正常清理 socket；
- Windows 和 Unix endpoint 生成器；
- 同 workspace 的两个窗口获得不同随机 endpoint；
- 诊断不泄漏完整 endpoint 或 Callback URI。

VS Code API、filesystem、platform、random ID 和 server factory 应可注入或隔离，避免单元测试依赖真实编辑器进程。

### 11.3 CLI unit tests

至少覆盖：

- endpoint 缺失时发送无 callback 的通知；
- endpoint 非法时 warning 并发送；
- `focused=true` 返回 0、输出固定抑制文本且不调用 Notifier；
- `focused=false` 使用 IPC callback；
- 显式 `--url` 仍执行焦点查询；未抑制时显式 URL 覆盖 callback；
- 非法显式 URL 在查询前失败；
- callback 缺失或非法时发送无 Action；
- 连接失败、拒绝、reset、HTTP 非 200、非 JSON、错误 version、非法 focused 和超时均静默 fail-open；
- 超过 8 KiB 响应立即失败并 fail-open；
- IPC 的 100 ms 与 Notifier 的 `--timeout` 相互独立；
- 不再读取旧 callback 环境变量。

### 11.4 真实 IPC integration tests

在支持的平台使用真实 `http.createServer().listen(path)` 验证 CLI client：

- Unix CI 运行 filesystem socket 测试；
- Windows CI 运行 named pipe 测试；
- 请求 path、HTTP 解析、响应大小和连接关闭真实生效；
- server 不存在或退出后 client 在预算内返回 unavailable；
- 测试产生的 socket 和临时目录全部清理。

平台不匹配的测试可以显式 skip，但不能仅靠 mock 宣称跨平台 IPC 已验收。

## 12. 人工验收矩阵

每个准备宣称支持的环境至少执行：

1. 单 VS Code 窗口聚焦：CLI 抑制，无 Toast；
2. 单窗口失焦：显示 Toast，点击回到来源窗口；
3. 两个不同 workspace 窗口：只按来源窗口焦点决定；
4. 两个相同 workspace 窗口：endpoint 和 callback 不串窗；
5. 两个空窗口：endpoint 和 callback 不串窗；
6. 显式 `--url`：聚焦时仍抑制，失焦时打开显式网页；
7. 关闭或禁用扩展：CLI fail-open；
8. Extension Host/window reload：普通单窗口下旧恢复终端继续查询；重绑失败时 fail-open；
9. 新建或重启终端：重新获得 endpoint 并恢复查询；
10. Notifier 不可达：聚焦时抑制成功，失焦或查询失败时保持原连接错误；
11. 状态诊断不泄漏 endpoint 和 Callback URI。

环境矩阵：

- VS Code Stable + Windows 本机；
- WSL；
- Dev Container；
- Remote SSH。

“设计兼容”不等于“正式支持”。只有实际通过上述端到端矩阵的环境才能写入支持列表。

## 13. 建议实施顺序

1. 在 protocol 中加入 Window Context contract 和测试；
2. 实现可独立测试的 endpoint generator；
3. 实现 Window Context HTTP server 和真实 Unix socket 测试；
4. 重构扩展激活流程和诊断；
5. 实现 CLI Window Context client；
6. 重构 CLI 的校验、抑制、Action 选择顺序；
7. 删除旧 callback 环境变量代码和测试；
8. 增加 Windows named pipe CI/测试；
9. 更新 runtime/type 版本声明；
10. 运行全部自动化检查；
11. 构建 VSIX 并执行人工矩阵；
12. 验收后更新 PRD、README、旧规格和 ADR 状态说明。

## 14. 完成标准

实现只有同时满足以下条件才算完成：

- `pnpm check` 通过；
- `pnpm build` 通过；
- VSIX 能成功打包；
- Unix socket 自动化测试通过；
- Windows named pipe 自动化测试在 Windows 环境通过；
- 聚焦抑制路径能够证明未调用 Notifier；
- 所有 IPC 故障路径均在 100 ms 预算附近 fail-open，不吞通知；
- 相同 workspace 多窗口和空窗口没有串窗；
- callback 不再通过旧环境变量传递；
- Notifier 协议和职责未改变；
- 日志和诊断不泄漏 endpoint 或 Callback URI；
- 每个宣称支持的 Remote 环境完成人工验收；
- 文档与实际支持状态同步。

## 15. 明确非目标

本次不实现：

- 系统终端、Task、Debug Adapter 或其他扩展来源关联；
- 窗口可见、最小化、遮挡或近期活动判断；
- `--force` 或用户可配置的抑制策略；
- IPC 鉴权 token；
- 稳定 endpoint、旧终端自动重连、window registry 或常驻 broker；
- 长连接、订阅、缓存、轮询或重试；
- Notifier 侧抑制、抑制审计或统计；
- 任意 VS Code command、文件、workspace 或终端数据读取；
- 旧 callback 环境变量兼容；
- VS Code Insiders、Cursor 或其他兼容编辑器的支持承诺。
