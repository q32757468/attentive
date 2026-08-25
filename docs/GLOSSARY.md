# Glossary

## Attentive

本项目整体名称，一套由外部系统触发 Windows 系统通知的软件。

## Notifier

通知器。运行在 Windows 桌面主机上的网络服务，接收 HTTP 通知请求并显示 Windows Toast。

## CLI

命令行客户端。外部系统通过它调用 notifier，不负责自动启动 notifier，也不负责第一阶段的异步任务追踪。

## Protocol

协议包。存放 CLI 与 notifier 之间共享的请求、响应、错误代码和校验模型。

## Detector

检测器。未来用于发现或关联非终端来源上下文的集成组件。VS Code 终端回跳扩展不扫描窗口，也不依据状态推断来源，因此不称为 detector。

## VS Code Callback Extension

VS Code 回调扩展。为每个 VS Code Stable 窗口注册 URI handler，通过 `asExternalUri` 生成窗口定向 Callback URI，并启动只读的 Window Context IPC server；随后创建或重启的集成终端只获得 IPC Endpoint。

## Callback URI

回调 URI。由来源 VS Code 窗口通过 `asExternalUri` 生成的 opaque URI。CLI 和 Notifier 只负责原样传递与打开，不解析或重写其中的窗口路由参数。

## `ATTENTIVE_VSCODE_CALLBACK_URI`（历史变量）

VS Code 回调扩展注入集成终端的环境变量。值是完整 Callback URI，不是 workspace、folder、file URI 或认证凭据。

这是 ADR-0002 使用过的历史变量。ADR-0003 实现后扩展不再贡献，CLI 不再读取，也不保留兼容 fallback。

## Window Context

窗口上下文。来源 VS Code 窗口在 CLI 发送通知前提供的只读快照。ADR-0003 中只包含必填的 `focused` 和可选的 Callback URI，不包含 workspace、活动文件、终端、选区或可执行命令。

## Window Context IPC

CLI 从来源 VS Code 窗口主动查询 Window Context 的本地通信通道。Windows 使用 named pipe，Unix、WSL 和 Linux Remote Extension Host 使用 Unix domain socket，并在该 handle 上承载短连接 HTTP/JSON。

## `ATTENTIVE_VSCODE_IPC_ENDPOINT`

VS Code 扩展向随后创建或重启的集成终端贡献的非持久环境变量。值是当前 Extension Host 激活期间的 opaque socket 或 pipe 地址。它用于定位 Window Context IPC，不是稳定窗口 ID，也不作为应用层认证凭据。

## Focused

聚焦状态。直接对应 `vscode.window.state.focused`，表示来源 VS Code 窗口当前是否拥有操作系统焦点。它不表示窗口是否可见、是否最小化、是否被其他窗口遮挡，也不同于表示近期交互的 `active`。

## Notification Intent

通知意图。CLI 参数已经合法、但尚未经过窗口焦点策略判断的候选通知。Notification Intent 不是发送给 Notifier 的协议对象，也没有 Notification ID。

## Notification Suppression

通知抑制。CLI 查询到来源 VS Code 窗口聚焦后，以退出码 0 结束且不联系 Notifier 的策略结果。被抑制的 Notification Intent 不会成为 NotificationRequest，也不会生成 Notification ID。

## Fail-open

失败时放行。Window Context IPC 缺失、不可达、超时或返回无效核心状态时，CLI 继续向 Notifier 发送通知，确保 VS Code 增强能力故障不会吞掉通知。合法的 `focused` 可以独立生效；无效或缺失的 Callback URI 只会让点击动作降级。

## Source

通知来源标识，例如 `ci`、`backup` 或 `my-tool`。第一阶段用于日志和诊断，不默认展示在通知正文中。

## Metadata

随通知传递的额外 JSON object。第一阶段不展示，仅为调试和未来扩展保留。

## Action

通知点击后的受控行为。当前唯一类型是 `open-uri`，只允许打开 `http:`、`https:` 或 `vscode:` URI，不执行任意命令。

## Open URI Action

点击通知时请求操作系统打开 URI 的 Action。Notifier 不理解 URI 所代表的软件上下文，只校验协议边界并交给 Windows Shell。

## Notification ID

notifier 为每条已接收通知生成的 UUID。它只标识该通知请求，不代表可更新或可撤回的持久化对象。

## Task ID

用于关联异步任务与来源上下文的标识。由于第一阶段暂不实现 detector 和异步上下文关联，Task ID 暂不属于第一阶段协议。

## Context Handle

由 Detector 签发、用于精确关联软件窗口或运行上下文的句柄。VS Code 终端回跳直接传递 Callback URI，不引入 Context Handle；非终端场景未来仍可能需要它。

## Extension Host Environment

VS Code Extension Host 进程的 `process.env`。未来可以评估用它向其他扩展启动的子进程传播上下文，但本期不会修改它，也不承诺覆盖非终端调用。
