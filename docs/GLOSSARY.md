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

VS Code 回调扩展。为每个 VS Code Stable 窗口注册 URI handler，通过 `asExternalUri` 生成窗口定向 Callback URI，并把它注入随后创建或重启的集成终端。

## Callback URI

回调 URI。由来源 VS Code 窗口通过 `asExternalUri` 生成的 opaque URI。CLI 和 Notifier 只负责原样传递与打开，不解析或重写其中的窗口路由参数。

## `ATTENTIVE_VSCODE_CALLBACK_URI`

VS Code 回调扩展注入集成终端的环境变量。值是完整 Callback URI，不是 workspace、folder、file URI 或认证凭据。

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
