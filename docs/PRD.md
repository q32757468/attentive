# Attentive PRD

- 当前实现：0.1 通知闭环与 VS Code 窗口上下文 IPC
- 后续目标：按验收矩阵扩展已验证的 Remote 环境支持

## 1. 背景

Attentive 是一套可被外部系统调用的 Windows 通知软件。当前最小闭环由通知器网络服务、CLI 和共享协议组成：外部系统通过 CLI 调用 Notifier，在 Windows 上显示系统通知。

当前实现是在 VS Code 集成终端中运行 CLI 时，通过来源窗口的本地 IPC 查询实时 `focused` 状态和 callback URI。用户点击 Windows Toast 后，VS Code 将 callback 路由回生成它的窗口；来源窗口聚焦时 CLI 在联系 Notifier 前抑制通知。

## 2. 目标

- 使用 pnpm 管理 TypeScript monorepo；
- 提供 Windows 通知器网络服务；
- 提供向 Notifier 发送通知的 CLI；
- 支持本机和局域网中的远程 CLI 访问 Notifier；
- 使用受控 Action 表达通知点击行为；
- 在 VS Code Stable 集成终端中精确回跳来源窗口；
- 正确区分相同工作区窗口和空窗口；
- 窗口上下文缺失时仍显示普通通知；
- 保持 VS Code 扩展、CLI、Protocol 和 Notifier 的职责边界。

## 3. 非目标

当前 VS Code 回跳版本不实现：

- 恢复来源终端、活动文件、编辑器或光标；
- 修改已运行终端的环境；
- 系统终端、Task、Debug 进程或其他扩展来源识别；
- Extension Host `process.env` 注入；
- window registry、token、context handle、task ID 或 broker；
- 通知更新、撤回、进度通知、幂等和队列持久化；
- 认证、TLS 和细粒度权限；
- Windows 服务、开机启动、安装器和自动更新；
- VS Code Insiders、Cursor 或其他编辑器；
- 多平台通知实现；
- 自动修改 Windows 防火墙；
- Marketplace 或 npm 发布。

## 4. Monorepo 包

```text
packages/
├── notifier          # Windows 通知 HTTP 服务
├── cli               # 通知命令行客户端
├── protocol          # HTTP 协议类型、校验和共享模型
└── vscode-extension  # VS Code callback URI 与终端环境注入
```

技术栈：TypeScript、Node.js、pnpm workspace、tsup。VS Code 扩展最低支持 Stable `^1.100.0`，首版构建本地 VSIX。

## 5. 用户场景

### 5.1 普通通知

外部系统执行：

```bash
attentive notify \
  --title "构建完成" \
  --body "任务执行成功" \
  --source "ci"
```

CLI 请求 Notifier，Notifier 在 Windows 上显示一次性系统通知。

### 5.2 显式网页动作

```bash
attentive notify \
  --title "构建完成" \
  --body "查看构建结果" \
  --url "https://example.com/build/123"
```

`--url` 转换为 `open-uri` Action。点击通知时打开该 HTTP/HTTPS URL。

### 5.3 VS Code 窗口回跳与聚焦抑制

VS Code 扩展通过 `asExternalUri` 生成窗口 callback，并启动当前 Extension Host 生命周期内的本地 Window Context server，向新建或重启的集成终端设置：

```text
ATTENTIVE_VSCODE_IPC_ENDPOINT=<opaque socket or pipe path>
```

CLI 在发送前查询 `GET /v1/window-context`。当 `focused=true` 时输出固定抑制信息并以退出码 0 结束，不联系 Notifier；当 `focused=false` 时按显式 `--url`、IPC callback URI、无 Action 的顺序构造通知。endpoint 缺失、非法、不可达或响应无效时 fail-open 发送普通通知；合法的 `focused` 独立生效，非法 callback 只删除点击动作。

## 6. 通知请求

### 6.1 字段

```json
{
  "title": "构建完成",
  "body": "任务执行成功",
  "source": "ci",
  "action": {
    "type": "open-uri",
    "uri": "https://example.com/build/123"
  },
  "metadata": {}
}
```

- `title`：必填，通知标题；
- `body`：必填，纯文本通知正文；
- `source`：可选，来源标识，用于日志和诊断，不默认拼接到正文；
- `action`：可选，通知点击后的受控行为；
- `metadata`：可选 JSON object，用于调试和未来扩展，不在通知中展示。

当前唯一 Action 类型是 `open-uri`：

- `uri` 必须使用 `http:`、`https:` 或 `vscode:`；
- `uri` 最大长度为 4096 个字符；
- 不允许命令、脚本或其他 URI scheme。

### 6.2 行为

- 每次请求产生一条新通知；
- Notifier 生成 UUID 形式的 `notificationId`；
- 成功表示请求已被 Notifier 接收并提交给 Windows，不保证用户实际看到或点击；
- 一次通知点击至多打开一次 Action URI；
- 当前不支持幂等、更新、撤回和重试。

## 7. HTTP API

```text
POST /api/v1/notifications
GET  /health
```

项目尚处私有 0.1 阶段，`action` 直接替换未发布的 `url` 请求字段，端点仍为 v1。

成功创建通知返回 HTTP `201 Created` 和 `notificationId`。错误统一使用：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "title is required"
  }
}
```

## 8. 网络与配置

- 默认监听 `0.0.0.0:8765`，支持配置监听地址和端口；
- 不做认证；同一局域网内可访问 Notifier 的设备可以发送通知；
- CLI 的 Notifier 地址优先级为：

```text
命令行参数 > 环境变量 > 配置文件 > 默认值
```

- 默认不自动启动 Notifier；
- 默认不自动修改 Windows 防火墙；
- VS Code callback URI 不改变当前网络信任边界。

## 9. CLI

主要命令：

```bash
attentive notify --title "..." --body "..."
```

点击动作优先级为：

```text
显式 --url > IPC callbackUri > 无 Action
```

显式 `--url` 非法时返回非零退出码，且不会被聚焦抑制掩盖。IPC endpoint 格式非法时向 stderr 输出 warning；连接失败、超时和响应错误静默 fail-open。Notifier 连接失败、超时和 HTTP 错误返回非零退出码，默认不自动重试。

## 10. VS Code 扩展

- Extension ID 为 `attentive.attentive-vscode`；
- 使用 `*` 激活，激活逻辑必须轻量；
- 声明为 workspace extension；
- 注册 `/focus` URI handler；
- 必须原样保存 `asExternalUri` 返回的完整 URI，并由 Window Context IPC 动态返回；
- 使用非持久的 `environmentVariableCollection` 贡献 `ATTENTIVE_VSCODE_IPC_ENDPOINT`；
- 新建或重启的集成终端获得 endpoint；窗口重载后恢复的旧终端可能持有已失效 endpoint，并按 fail-open 处理；
- 每次 IPC 请求即时读取 `vscode.window.state.focused`；
- handler 不弹窗、不打开文件、不增加失效 URI 回退；
- 提供不泄露完整 URI 的 callback 状态诊断命令。

实现不根据 Remote 类型编写分支。是否正式支持某个 Dev Container、WSL、SSH 或其他环境，取决于该环境是否完成端到端验收。

## 11. Notifier URI 打开

Windows Notifier 使用参数化的 `explorer.exe <uri>` 打开已校验 URI，禁止经过 `cmd.exe`、PowerShell 或其他 shell。Notifier 不解析 VS Code callback 参数，也不理解 VS Code 窗口模型。

## 12. 验收标准

自动化测试至少覆盖：

- Protocol 的 Action 类型、scheme 和长度校验；
- CLI 的 IPC endpoint 查询、聚焦抑制、显式覆盖、缺失和非法降级；
- Notifier 点击去重和无 shell URI opener；
- VS Code 扩展的 callback 生成、IPC server、非持久 endpoint 注入和 handler 路径校验。

人工验收至少覆盖：

- 不同工作区的两个窗口；
- 相同工作区的两个窗口；
- 两个空窗口；
- 新建和重启终端；
- callback 缺失或非法、IPC 不可用时仍显示普通通知；
- 显式网页 URL 覆盖 VS Code callback；
- 来源窗口关闭后的 VS Code 原生行为；
- Windows Stable 上真实 Toast 点击；
- 每个准备宣称支持的 Remote 环境。

详细规格见 [VS Code 窗口上下文 IPC 实施规格](SPEC/VSCODE_WINDOW_CONTEXT_IPC_SPEC.md)，技术决策见 [ADR-0003](ADR/0003-vscode-window-context-ipc.md)。
