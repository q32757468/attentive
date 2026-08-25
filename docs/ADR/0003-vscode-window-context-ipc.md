# ADR-0003：通过 VS Code 窗口本地 IPC 查询上下文并抑制通知

- 状态：已实现；Unix 自动化通过，Windows/Remote 人工验收待执行
- 日期：2026-08-25
- 相关决策：[ADR-0002](0002-vscode-window-callback-uri.md)
- 实施规格：[VS Code 窗口上下文 IPC 实施规格](../SPEC/VSCODE_WINDOW_CONTEXT_IPC_SPEC.md)

## 背景

ADR-0002 让 VS Code 扩展通过终端环境变量把窗口定向的 Callback URI 单向传给 CLI。该方式适合传递创建终端时即可确定的值，但 CLI 无法在发送通知前主动读取来源窗口的实时状态。

新的目标是：Attentive CLI 从 VS Code 集成终端运行时，在联系 Notifier 前查询来源窗口；如果该窗口当前拥有操作系统焦点，则不显示系统通知，否则继续发送。

VS Code `window.state` 能直接提供 `focused` 和 `active`，但没有通用的窗口可见、最小化或遮挡状态。`focused` 语义明确且存在于项目最低支持的 VS Code 1.100 API 中，因此不通过平台私有接口推测“可见”。

本设计还需要保持现有边界：来源窗口由终端继承的窗口专属值确定，Notifier 不理解 VS Code 私有状态，状态服务不开放通用命令执行能力，查询故障不能导致通知丢失。

## 决策

### 状态与适用范围

状态 A 定义为来源 VS Code 窗口的 `vscode.window.state.focused`。

只有继承了窗口 IPC endpoint 的 VS Code 集成终端及其后代进程参与状态查询。外部终端、Task、Debug Adapter、其他扩展和无法确定来源窗口的进程不尝试猜测窗口归属，继续正常发送通知。

多个 VS Code 窗口各自运行独立 IPC server。CLI 只查询启动它的终端所属窗口；其他窗口是否聚焦不影响本次决策。

实现对本机 Windows、WSL、Dev Container 和 Remote SSH 的 Extension Host/终端同侧拓扑保持兼容，不针对 Remote 类型编写分支。只有完成端到端验收的环境才能被正式声明为支持。

### 进程与职责边界

通信链路为：

```text
来源 VS Code 窗口 Extension Host
  ├─ 读取 window.state.focused
  ├─ 持有当前 Callback URI
  └─ HTTP/JSON over local IPC
              │
              │ ATTENTIVE_VSCODE_IPC_ENDPOINT
              ▼
       来源窗口的集成终端
              │
              ▼
         Attentive CLI
          ├─ focused=true  -> 抑制，退出 0
          ├─ focused=false -> 发送 NotificationRequest
          └─ 查询失败      -> fail-open 发送
                                      │
                                      ▼
                              Windows Notifier
```

状态门控由 CLI 执行。Notifier 仍只接收确实需要显示的 `NotificationRequest`，不接收 VS Code 状态或 `suppressed` 标识，也不负责决定是否提醒。

聚焦时，CLI 不联系 Notifier、不生成 Notification ID，以退出码 `0` 结束，并在 stdout 明确说明通知因来源 VS Code 窗口聚焦而被抑制。抑制是成功的策略结果，不是发送错误。

### IPC 传输

采用与 VS Code Extension Host CLI 相同类型的通信模式：随机的本地 IPC handle 通过环境变量传给 CLI，handle 上承载 HTTP/JSON。

- Windows 使用 named pipe；
- Unix、WSL 和 Linux Remote Extension Host 使用 filesystem Unix domain socket；
- 每个窗口、每次 Extension Host 激活生成独立的高熵随机 endpoint；
- 不根据 workspace、folder、窗口标题或文件路径推导 endpoint；
- Windows pipe 名称使用 `\\.\pipe\attentive-vscode-<random>-sock` 形式；
- Unix 优先使用当前用户的 `XDG_RUNTIME_DIR`，否则在系统临时目录下创建权限为 `0700` 的 Attentive 用户私有目录；
- Unix server listening 后将 socket 文件权限收紧为 `0600`，失败时不贡献该 endpoint；
- Unix endpoint 必须控制长度，兼容 Linux 和 macOS 的 socket path 限制；
- server 成功进入 listening 状态后才能向终端环境贡献 endpoint。

环境变量为：

```text
ATTENTIVE_VSCODE_IPC_ENDPOINT=<opaque socket or pipe path>
```

该 contribution 设为非持久。每次 Extension Host 激活生成新 endpoint，不尝试跨重载重占旧地址。新建或重启的终端获得新值；已经运行或在窗口重载后恢复的 shell 仍可能持有旧值，其查询会失败并 fail-open，直到终端被新建或重启。

扩展正常停用时关闭 server，并在非 Windows 平台 best-effort 清理 socket 文件。进程崩溃留下的随机 socket 不在下一次激活时盲目删除或重占。

### Window Context API

CLI 使用 Node `http.request({ socketPath })` 发出短连接请求：

```http
GET /v1/window-context
Connection: close
```

成功响应为：

```json
{
  "version": 1,
  "focused": false,
  "callbackUri": "vscode://..."
}
```

约束如下：

- `version` 和 `focused` 必填；
- `callbackUri` 可选，最大长度继续为 4096 个字符；
- 完整 HTTP response body 最大为 8 KiB；
- endpoint 查询的连接、写入和读取共用 `100 ms` 总超时；
- server 限制 HTTP headers、并发连接、空闲时间和响应大小；
- 只允许固定 method/path，不提供批处理、长连接、订阅或任意 VS Code command；
- Window Context 的共享类型和校验放入 protocol 包的独立模块，但 Notifier 不读取或处理这些类型。

CLI 分别校验响应字段。`focused` 合法但 `callbackUri` 缺失或非法时，聚焦判断仍然有效；需要发送时降级为无 VS Code 点击动作的普通通知。版本、响应结构或 `focused` 非法时，整个查询失败并执行 fail-open。

查询时刻只提供窗口状态快照。查询完成后到 Toast 提交前的窗口焦点变化属于不可消除的 TOCTOU 竞态，本设计接受该限制，不增加状态订阅或缓存。

### Callback URI 合并与 CLI 顺序

实现 ADR-0003 时，扩展停止贡献 `ATTENTIVE_VSCODE_CALLBACK_URI`，Callback URI 改由 `GET /v1/window-context` 动态返回。项目仍处开发阶段，不保留旧 CLI、旧扩展或旧终端的兼容分支。

CLI 的处理顺序为：

1. 解析并校验所有显式参数；
2. 如果存在合法 IPC endpoint，查询 Window Context；
3. `focused=true` 时成功抑制；
4. 否则构造并发送 `NotificationRequest`；
5. Action 选择顺序为显式 `--url`、有效的 `callbackUri`、无 Action。

显式 `--url` 只决定点击动作，不绕过焦点抑制。非法显式参数始终报错，不能因为窗口恰好聚焦而被当作成功命令。

endpoint 缺失时直接发送通知。endpoint 格式非法时输出 warning 后发送。连接失败、拒绝、超时、server 不可用或响应非法属于预期的降级路径，正常执行时不逐次输出 warning，而是静默发送通知。

首版不增加 `--force`、配置开关、状态缓存或重试。

### 安全边界

Window Context API 不使用 bearer token 或其他应用层认证。

Unix 通过用户私有目录和最小 socket 权限限制访问；Windows 使用随机 named pipe 名称和操作系统默认访问控制。项目不承诺在 Windows 上由应用层严格验证调用者的 OS 用户身份，并明确接受能够发现 endpoint 的本地进程查询 `focused` 和 Callback URI 的风险。

接受该风险的前提是接口只读、数据影响有限，并且不能通过它执行命令、修改 VS Code 状态或读取 workspace、文件、终端内容。endpoint、Callback URI 和完整响应不得写入普通日志或诊断输出。

### 诊断与运行时

扩展现有诊断命令扩展为显示：

- IPC server 是否正在监听；
- endpoint 类型；
- 当前窗口是否 focused；
- Callback URI 是否可用；
- 最近一次 IPC 错误的分类和时间。

诊断不显示完整 endpoint、Callback URI 或请求内容。

仓库声明 Node.js `>=18.18` 运行时基线。实现不依赖 Node 24 的 Linux abstract socket 或 `Symbol.asyncDispose`。VS Code 类型依赖应锁定到最低支持的 `1.100.x`，避免编译时类型版本漂移。

## 理由

- `focused` 是 VS Code 公共 API 直接提供、可跨平台解释的窗口状态；
- 每窗口 endpoint 沿集成终端进程继承链传播，能精确关联相同 workspace 的多个窗口和多个空窗口；
- HTTP/JSON over socketPath 已被 VS Code 用于类似的 CLI 到 Extension Host 通信，避免自建消息分帧协议；
- CLI 在发送前短路，保持 Notification API 的“请求创建通知”语义，不让 Notifier 同时处理创建与抑制；
- 动态返回 Callback URI 消除终端环境中缓存 Callback URI 的单独数据通道，并保证成功查询时获得当前 Extension Host 生成的值；
- fail-open 保证 IPC 增强能力故障时仍能显示通知；
- 随 Extension Host 生命周期使用随机 endpoint，避免为了恢复终端引入稳定窗口身份、broker 和 socket 重占状态机。

## 备选方案

### 向 Notifier 发送带抑制标识的请求

可以集中统计所有通知意图，但会让 `/api/v1/notifications` 同时表示“创建通知”和“不要创建通知”，还需要重新定义 `201 Created`、Notification ID 和 Notifier 的 VS Code 上下文边界。当前没有集中审计需求，因此拒绝。未来如需统计，应定义独立的决策事件，而不是把 `suppressed` 塞进 NotificationRequest。

### 继续通过独立环境变量传 Callback URI

可以在 IPC 故障时保留点击回跳，但形成两个窗口上下文数据源，Callback URI 还可能在 Extension Host 重载后过期。项目处于开发阶段，无兼容要求，因此拒绝双重注入和旧变量 fallback。

### 使用 loopback TCP HTTP

跨平台简单，但会增加端口选择、监听暴露、防火墙和来源限制问题。本需求的扩展与终端位于同一侧，本地 socket/pipe 更合适，因此拒绝。

### 使用自定义 newline-delimited JSON

可以减少 HTTP 表面，但需要自行实现分帧、错误和长度处理。VS Code 已验证 HTTP/JSON over socketPath 模式，因此拒绝自定义 framing。

### 使用稳定 endpoint 或常驻 broker

可以让窗口重载后恢复的终端继续查询，但需要稳定的每窗口身份、活性探测、冲突处理、stale socket 清理或额外进程。当前通知可以安全 fail-open，因此选择与 Extension Host 生命周期一致的随机 endpoint。

### 增加 bearer token

可以强化 Windows named pipe 的调用者校验，但会增加凭据生成、持久化、传递、比较和诊断边界。接口只读且影响有限，当前明确接受本地查询风险，因此不增加应用层认证。

### 使用 `active`、可见性或平台窗口 API

`active` 表示近期交互而不是当前焦点；VS Code 公共 API 不提供通用窗口可见或遮挡状态；平台 API 还会破坏 Remote 和跨平台模型。因此只使用 `focused`。

## 后续影响

- VS Code 扩展需要增加 IPC server、Window Context 读取、生命周期处理和诊断；
- CLI 需要在构造 NotificationRequest 前查询上下文，并实现成功抑制和 fail-open；
- protocol 需要增加与通知请求隔离的 Window Context 类型和校验；
- Notifier 及 `/api/v1/notifications` 请求模型不需要改变；
- `ATTENTIVE_VSCODE_CALLBACK_URI` 将被删除，不提供兼容期；
- 自动化测试需要覆盖 Unix socket、named pipe 可用时的平台测试、超时、非法响应、部分字段降级、多窗口隔离和 CLI 不联系 Notifier 的抑制路径；
- 人工验收需要覆盖本机多窗口、窗口重载后的旧终端 fail-open、新终端恢复，以及准备声明支持的 WSL、Dev Container 和 Remote SSH 组合；
- 如果未来需要无缝恢复终端、跨来源窗口查询、集中策略或审计，应新增 ADR，不在当前 server 上逐步扩展为通用 broker。
