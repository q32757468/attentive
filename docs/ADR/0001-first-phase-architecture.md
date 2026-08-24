# ADR-0001：第一阶段采用 CLI 到 Windows 通知器的最小架构

- 状态：已接受
- 日期：2026-08-24

## 背景

项目目标是让外部系统能够显示 Windows 系统通知，并为未来的 VS Code 和其他软件检测器预留扩展空间。第一阶段需要快速验证通知链路，不应被多窗口上下文、远程开发和异步任务关联模型阻塞。

## 决策

第一阶段采用三个 pnpm workspace 包：

```text
notifier <- protocol
cli      <- protocol
```

其中：

- `notifier` 是 Windows 通知 HTTP 服务；
- `cli` 是外部系统使用的命令行客户端；
- `protocol` 保存共享请求、响应、错误和校验模型。

通信链路为：

```text
外部系统 -> cli -> HTTP/JSON -> notifier -> Windows Toast
```

notifier 默认监听 `0.0.0.0:8765`，不提供认证。CLI 通过命令行参数、环境变量或配置文件获得 notifier 地址。

第一阶段只支持一次性通知，不实现任务 ID、context handle、检测器、通知持久化、重试或优雅关闭。

## 理由

- CLI 是外部系统最简单的集成入口。
- HTTP/JSON 便于 WSL、devcontainer 和未来其他语言客户端访问。
- 独立的 protocol 包可以避免 CLI 和 notifier 重复定义协议。
- 延迟任务的上下文关联只有在检测器存在后才有实际语义，因此暂缓 task ID 和 context handle。
- 默认局域网监听满足远程环境访问需求，但接受无认证带来的网络风险。

## 备选方案

### 仅监听 loopback

安全边界更小，但无法满足远程 CLI 访问 Windows 主机通知器的第一阶段需求。

### CLI 自动启动 notifier

会耦合进程管理、安装位置和生命周期，暂不纳入第一阶段。

### CLI 管理异步任务生命周期

只有在 CLI 能启动并等待目标命令时才可靠；当前外部系统可能在任意时间独立触发完成事件，因此不作为第一阶段核心模型。

### 首期实现 VS Code detector

会引入窗口上下文传递、多窗口关联、Extension Host 和远程扩展拓扑问题，超出最小通知闭环。

## 后续影响

未来加入 detector 时，应通过 protocol 扩展来源上下文和受控 action，而不是让 notifier 理解 VS Code 私有信息。未来若需要局域网安全访问，应增加认证和 TLS，而不是继续扩大无认证接口的能力。

