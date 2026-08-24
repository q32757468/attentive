# Attentive 第一阶段 PRD

## 1. 背景

Attentive 是一套可被外部系统调用的 Windows 通知软件。第一阶段先解决最小闭环：启动通知器网络服务，外部系统通过 CLI 调用它，在 Windows 上显示系统通知。

VS Code 检测器、远程窗口识别和其他软件集成不属于第一阶段。

## 2. 目标

- 使用 pnpm 管理 TypeScript monorepo。
- 提供一个 Windows 通知器网络服务。
- 提供一个 CLI，向通知器发送通知请求。
- 支持本机和局域网中的远程 CLI 访问通知器。
- 为后续检测器和更多平台保留清晰的协议边界。

## 3. 非目标

第一阶段不实现：

- VS Code 插件或其他检测器；
- VS Code 窗口识别、context handle 和 task ID；
- WSL/devcontainer 的自动发现或窗口回跳；
- 通知更新、撤回、进度通知和幂等；
- 通知队列持久化；
- 认证、TLS 和细粒度权限；
- Windows 服务、开机启动、安装器和自动更新；
- 多平台通知实现；
- 自动修改 Windows 防火墙；
- 优雅关闭；
- npm 包发布。

## 4. Monorepo 包

```text
packages/
├── notifier   # Windows 通知 HTTP 服务
├── cli        # 通知命令行客户端
└── protocol   # HTTP 协议类型、校验和共享模型
```

技术栈：TypeScript、Node.js、pnpm workspace、tsup。第一阶段不引入 Turborepo 或 Nx。

## 5. 用户场景

外部系统在任务完成时执行：

```bash
attentive notify \
  --title "构建完成" \
  --body "任务执行成功" \
  --source "ci"
```

CLI 请求通知器，通知器在 Windows 上显示一次性系统通知。

## 6. 通知请求

### 6.1 字段

```json
{
  "title": "构建完成",
  "body": "任务执行成功",
  "source": "ci",
  "url": "https://example.com/build/123",
  "metadata": {}
}
```

- `title`：必填，通知标题。
- `body`：必填，纯文本通知正文。
- `source`：可选，来源标识，用于日志和诊断，不默认拼接到正文。
- `url`：可选，只允许 `http` 和 `https`，点击通知时打开。
- `metadata`：可选 JSON object，用于调试和未来扩展，不在通知中展示。

### 6.2 行为

- 每次请求产生一条新通知。
- notifier 生成 UUID 形式的 `notificationId`。
- 成功表示请求已被 notifier 接收并提交给 Windows，不保证用户实际看到或点击。
- 第一阶段不支持幂等、更新、撤回和重试。

## 7. HTTP API

```text
POST /api/v1/notifications
GET  /health
```

成功创建通知返回 HTTP `201 Created` 和 `notificationId`。

错误统一使用：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "title is required"
  }
}
```

## 8. 网络与配置

- 默认监听 `0.0.0.0:8765`，支持配置监听地址和端口。
- 不做认证；同一局域网内可访问通知器的设备可以发送通知。
- CLI 通过命令行参数、环境变量或配置文件指定 notifier 地址，优先级为：

```text
命令行参数 > 环境变量 > 配置文件 > 默认值
```

- 默认不自动启动 notifier。
- 默认不自动修改 Windows 防火墙。

## 9. CLI

第一阶段主要命令：

```bash
attentive notify --title "..." --body "..."
```

CLI 默认输出人类可读文本，不实现 JSON 输出模式。连接失败、超时和 HTTP 错误返回非零退出码，默认不自动重试。

## 10. 运行与关闭

notifier 通过命令启动，例如：

```bash
attentive-notifier
```

第一阶段不实现优雅关闭。进程退出时不等待正在处理的请求，也不持久化未完成通知。

## 11. 验收标准

- 在 Windows 上启动 notifier 后，CLI 可以发送并显示系统通知。
- 本机 CLI 可以通过默认地址调用 notifier。
- 配置远程地址后，局域网或远程环境中的 CLI 可以调用 Windows 主机上的 notifier。
- 标题、正文、来源、URL 和 metadata 按协议传递。
- notifier、CLI 和协议错误可被调用方识别，并产生非零退出码或结构化 HTTP 错误。
- protocol、notifier HTTP 层和 CLI 错误处理具备自动化测试。

