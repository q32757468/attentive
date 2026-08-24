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

检测器。未来的来源上下文集成包，例如 VS Code detector。第一阶段暂不实现。

## Source

通知来源标识，例如 `ci`、`backup` 或 `my-tool`。第一阶段用于日志和诊断，不默认展示在通知正文中。

## Metadata

随通知传递的额外 JSON object。第一阶段不展示，仅为调试和未来扩展保留。

## Action / URL

通知点击后的行为。第一阶段只允许 HTTP 或 HTTPS URL，不执行任意命令。

## Notification ID

notifier 为每条已接收通知生成的 UUID。它只标识该通知请求，不代表可更新或可撤回的持久化对象。

## Task ID

用于关联异步任务与来源上下文的标识。由于第一阶段暂不实现 detector 和异步上下文关联，Task ID 暂不属于第一阶段协议。

## Context Handle

由 detector 签发、用于精确关联软件窗口或运行上下文的句柄。第一阶段暂不实现。

