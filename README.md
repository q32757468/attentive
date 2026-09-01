# Attentive

Attentive 是一个通过 HTTP 接收通知请求、并在 Windows 主机上显示系统通知的 pnpm TypeScript monorepo。

## 开发

```bash
pnpm install
pnpm run check
pnpm run build
```

启动 notifier：

```bash
pnpm run notifier
```

发送通知：

```bash
pnpm run notify -- \
  --title "构建完成" \
  --body "任务执行成功" \
  --source "ci" \
  --url "https://example.com/build/123"
```

指定 notifier 服务地址时：

```bash
pnpm run notify -- \
  --title "构建完成" \
  --body "任务执行成功" \
  --notifier-url "http://192.168.31.17:8765"
```

也可以构建后使用 `packages/notifier/dist/cli.js` 和 `packages/cli/dist/cli.js`。CLI 的 notifier 地址优先级为：命令行 `--notifier-url`、`ATTENTIVE_NOTIFIER_URL`、配置文件、默认值 `http://127.0.0.1:8765`。

配置文件默认位于 Windows 的 `%APPDATA%/Attentive/config.json`，其他系统的 `~/.config/attentive/config.json`，格式如下：

```json
{
  "notifierUrl": "http://192.168.1.10:8765"
}
```

HTTP 接口：

- `GET /health`
- `POST /api/v1/notifications`

## VS Code 窗口上下文 IPC

构建并安装本地 VS Code 扩展：

```bash
pnpm --dir packages/vscode-extension run package:vsix
```

安装生成的 VSIX 后，新建或重启 VS Code 集成终端。扩展会向终端贡献当前 Extension Host 激活期间的本地 IPC endpoint；CLI 在发送前查询来源窗口的 `focused` 状态和 callback URI。窗口聚焦时输出抑制原因且不联系 Notifier，失焦时在没有显式 `--url` 的情况下，点击会回到启动 CLI 的 VS Code 窗口。IPC 不可用时会 fail-open 发送普通通知。

如需检查是否生效，运行 **Attentive: Show VS Code Integration Status**。窗口重载后恢复的旧终端可能持有已失效 endpoint；重启终端即可获得新 endpoint。

详细规格见 [VS Code 窗口上下文 IPC 实施规格](docs/SPEC/VSCODE_WINDOW_CONTEXT_IPC_SPEC.md)，技术决策见 [ADR-0003](docs/ADR/0003-vscode-window-context-ipc.md)。
