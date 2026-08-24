# Attentive

Attentive 第一阶段是一个通过 HTTP 接收通知请求、并在 Windows 主机上显示系统通知的 pnpm TypeScript monorepo。

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
