# @attentive-kit/cli

Attentive 的命令行客户端，用于向 Attentive Notifier 发送桌面通知。

## 安装

需要 Node.js 18.18 或更高版本。

```bash
npm install --global @attentive-kit/cli
```

也可以通过 `npx` 直接运行：

```bash
npx @attentive-kit/cli notify \
  --title "构建完成" \
  --body "任务执行成功"
```

## 使用

请先启动可访问的 Attentive Notifier，然后发送通知：

```bash
attentive notify \
  --title "构建完成" \
  --body "任务执行成功" \
  --source "ci" \
  --url "https://example.com/build/123"
```

可用选项：

```text
--title <text>           通知标题（必填）
--body <text>            通知正文（必填）
--source <name>          来源标识
--url <http(s) URL>      点击通知时打开的 URL
--metadata <JSON>        JSON 格式的调试元数据对象
--notifier-url <URL>     Notifier 服务地址
--config <path>          配置文件路径
--timeout <milliseconds> 请求超时时间，默认 10000 毫秒
-h, --help               显示帮助
```

## 配置 Notifier 地址

Notifier 地址按以下优先级解析：

1. 命令行选项 `--notifier-url`
2. 环境变量 `ATTENTIVE_NOTIFIER_URL`
3. 配置文件
4. 默认地址 `http://127.0.0.1:8765`

默认配置文件位于：

- Windows：`%APPDATA%/Attentive/config.json`
- 其他系统：`~/.config/attentive/config.json`

配置文件示例：

```json
{
  "notifierUrl": "http://192.168.1.10:8765"
}
```

可以使用 `ATTENTIVE_CONFIG_FILE` 环境变量或 `--config` 指定其他配置文件。

## VS Code 集成

在安装 Attentive VS Code 扩展后，从扩展创建的新集成终端运行 CLI 时，CLI 会识别来源窗口：来源窗口处于聚焦状态时抑制通知；窗口失焦且未显式传入 `--url` 时，点击通知会返回该 VS Code 窗口。集成不可用时，CLI 会继续发送普通通知。

## License

MIT
