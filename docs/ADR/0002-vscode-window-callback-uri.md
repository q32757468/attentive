# ADR-0002：使用 VS Code callback URI 实现通知窗口回跳

- 状态：已接受
- 日期：2026-08-25

## 背景

Attentive CLI 在 VS Code 集成终端中运行时，Windows 通知需要在点击后回到来源窗口。工作区路径、活动文件、当前目录和最后聚焦窗口都不能唯一标识窗口，尤其无法区分打开相同工作区的多个窗口或多个空窗口。

VS Code 扩展可以注册 URI handler，并通过 `vscode.env.asExternalUri` 获得带窗口路由信息的外部 URI。扩展还可以通过 `ExtensionContext.environmentVariableCollection` 为随后创建的集成终端添加环境变量。

现有通知协议只有 HTTP/HTTPS `url`，Notifier 通过 `cmd.exe /c start` 打开它。该模型无法安全承载 VS Code callback URI，也不符合 ADR-0001 中“通过 protocol 扩展受控 action，避免 Notifier 理解 VS Code 私有信息”的后续约束。

## 决策

新增 `packages/vscode-extension`。每个 VS Code Stable 窗口中的扩展实例：

1. 注册 `vscode://attentive.attentive-vscode/focus` 的 URI handler；
2. 使用 `vscode.env.asExternalUri` 生成该窗口的完整 callback URI；
3. 通过持久化的 `environmentVariableCollection` 将它写入 `ATTENTIVE_VSCODE_CALLBACK_URI`，使 VS Code 重载时恢复的终端可以直接使用缓存贡献；
4. 新建或重启的集成终端获得该变量；窗口重载时由 VS Code 恢复的终端复用持久化贡献。

CLI 在用户没有显式传入 `--url` 时读取该变量。缺失时继续发送无点击动作的通知；非法时输出 warning 后继续发送。显式 `--url` 优先，并继续只接受 HTTP/HTTPS。

协议 v1 将顶层 `url` 替换为：

```json
{
  "action": {
    "type": "open-uri",
    "uri": "vscode://attentive.attentive-vscode/focus?..."
  }
}
```

`open-uri` 只允许 `http:`、`https:` 和 `vscode:`，最大长度为 4096 个字符。Notifier 不解析 VS Code 参数，通过无 shell 的 `explorer.exe <uri>` 打开 URI，并保证一次点击至多打开一次。

扩展使用 `*` 激活、`extensionKind: ["workspace"]`、持久化 `environmentVariableCollection`，最低支持 VS Code Stable `^1.100.0`。首版只构建本地 VSIX。

## 理由

- 窗口选择由 VS Code 自身的 URI 路由完成，不需要 Attentive 维护窗口登记或推测来源；
- 环境变量沿集成终端的自然进程继承链传播；持久化 collection 还可以避免窗口重载后恢复终端先于扩展重新激活时缺少贡献；
- opaque callback URI 不暴露工作区或活动文件信息；
- 通用 `open-uri` action 保持 Notifier 与 VS Code 解耦；
- scheme 白名单和无 shell 打开方式限制了点击动作的执行能力；
- fail-open 行为保证窗口上下文故障不会导致通知丢失。

## 备选方案

### 使用 workspace、folder 或 file URI

无法区分打开相同资源的多个窗口，也不能表示空窗口，因此拒绝。

### 自建 window ID、token 和 registry

可以承载更丰富的实时上下文，但需要生命周期、过期、清理、校验和 IPC 设计。当前需求只需回跳窗口，复杂度不合理，因此留待非终端场景重新评估。

### 使用非持久化的 collection

窗口重载后，持久化终端只能先恢复没有 callback 的环境，等扩展重新激活并重新注入后才会显示环境变更提示。因此拒绝该方案；项目采用 VS Code API 默认的持久化 collection 生命周期，与 Python 扩展一致。

### 修改 Extension Host 的 `process.env`

可能覆盖由其他扩展直接启动 CLI 的场景，但传播条件与安全边界不同。本期明确只支持集成终端，因此只记录为未来方案。

### 扩大原 `url` 字段的 scheme 白名单

改动较小，但会继续把通用点击行为压缩在名为 URL 的字段中，也不利于未来增加受控 action 类型，因此改为 tagged action。

### 使用 `cmd.exe /c start`

URI 的 query 可能包含 shell 元字符，不应交给命令解释器，因此改用参数化的 `explorer.exe`。

## 后续影响

- 协议、CLI、Notifier 和文档需要同步从 `url` 迁移到 `open-uri` action；
- CLI 的用户界面继续保留 `--url`，但内部转换为 action；
- 需要新增 VS Code 扩展的构建、VSIX 打包、单元测试和人工多窗口验收；
- 已存在的终端不保证获得新 callback；如果窗口重载时 callback URI 发生变化，持久化重连的终端也可能需要新建或重启；
- Remote 环境是否正式支持取决于各环境的端到端验收结果；
- 失效 callback 保持 VS Code 原生行为，不增加 fallback；
- 非终端来源需要新的 ADR，不得默认为本决策已经覆盖。
