# VS Code 窗口回跳规格

- 状态：已实现并验收
- 日期：2026-08-25
- 决策记录：[ADR-0002](../ADR/0002-vscode-window-callback-uri.md)

> 后续设计：[VS Code 窗口上下文 IPC 实施规格](VSCODE_WINDOW_CONTEXT_IPC_SPEC.md) 已实现。新规格已以 IPC 动态返回 Callback URI，并取代本文的 callback 环境变量传递模型；本文保留为历史规格。

## 1. 背景

Attentive CLI 可以在 VS Code 集成终端中运行。CLI 发出 Windows 通知后，用户希望点击通知回到启动该 CLI 的 VS Code 窗口。

本设计只处理终端来源。由其他扩展、Task、Debug Adapter、Git Hook、系统终端或常驻 daemon 启动 CLI 的情况不属于本期范围。

## 2. 目标

- 点击通知时精确回到来源 VS Code 窗口；
- 正确区分打开相同工作区的多个窗口和多个空窗口；
- 不依据窗口标题、工作区路径、当前目录或最后活动窗口猜测来源；
- CLI 缺少有效窗口上下文时仍可发送普通通知；
- Notifier 只理解通用点击动作，不理解 VS Code 私有模型；
- 为未来非终端来源保留扩展方向，但本期不提前实现 registry、token 或 broker。

## 3. 非目标

本期不实现：

- 恢复来源终端、活动文件、编辑器组、选区或光标；
- 修改已经运行的 shell 环境；
- 从系统终端、Task、Debug 进程或其他扩展自动识别窗口；
- 窗口登记文件、window ID、token、PID 校验、TTL 或本地 IPC broker；
- 对已关闭或已重载窗口的 URI 增加自定义回退；
- VS Code Insiders、Cursor 或其他兼容编辑器；
- Marketplace 发布。

## 4. 核心设计

```text
VS Code Stable 窗口
  ├─ registerUriHandler("/focus")
  ├─ asExternalUri(...) 生成窗口定向 URI
  └─ ATTENTIVE_VSCODE_CALLBACK_URI
          │
          ▼ 新建、重启或窗口重载后恢复的集成终端
        Attentive CLI
          ├─ 显式 --url 存在：使用 HTTP/HTTPS URL
          ├─ 否则使用合法的 VS Code callback URI
          └─ 缺失或非法：继续发送无点击动作的通知
                  │
                  ▼
        action: { type: "open-uri", uri }
                  │
                  ▼
        Windows Notifier
          └─ explorer.exe <uri>，不经过 shell
                  │
                  ▼
        来源 VS Code 窗口
```

关键点不是读取一个现成的“当前窗口 URI”，而是让每个扩展实例创建自己的回调 URI。VS Code 为 `asExternalUri` 的结果加入窗口路由信息；调用该 URI 时，由 VS Code 将请求送回生成它的窗口。

## 5. VS Code 扩展

### 5.1 包与身份

扩展作为新的 workspace 包加入 monorepo：

```text
package:      packages/vscode-extension
package name: attentive-vscode
name:         attentive-vscode
publisher:    attentive
extension id: attentive.attentive-vscode
```

首版只构建本地 VSIX。Extension ID 必须保持稳定，因为它是 callback URI authority 的一部分。

扩展最低支持 VS Code Stable `^1.100.0`，并声明：

```json
{
  "extensionKind": ["workspace"],
  "activationEvents": ["*"]
}
```

选择 workspace extension host，是为了让 Remote 场景中的扩展与集成终端位于同一侧。启动激活必须保持轻量，只执行 handler 注册、URI 生成和单个环境变量注入。

### 5.2 URI handler

扩展注册一个 handler，并只接受 `/focus`：

```text
vscode://attentive.attentive-vscode/focus
```

该基础 URI 必须先交给 `vscode.env.asExternalUri`，环境变量保存返回值的完整字符串，不能自行拼接或删除 query 参数。

handler 收到 `/focus` 后不弹消息、不打开文件，也不执行额外 UI 命令。VS Code 完成窗口路由和唤起即为成功。其他路径不执行操作。

窗口已经关闭、重载或 URI 已失效时，不增加自定义恢复或重定向逻辑，保持 VS Code 原生行为。

### 5.3 终端环境变量

扩展通过 `context.environmentVariableCollection` 设置：

```text
ATTENTIVE_VSCODE_CALLBACK_URI=<asExternalUri 返回的完整 URI>
```

约束如下：

- 使用全局 collection，使当前窗口随后创建的所有集成终端获得相同值；
- `persistent` 设为 `true`，让 VS Code 在窗口重载时把缓存的贡献直接应用到恢复终端；URI 仍在扩展激活时通过 `asExternalUri` 重新解析；
- mutation 只在进程创建时应用；
- 不在普通停用流程中主动删除 mutation，由 VS Code 管理 collection 生命周期；
- 已经运行的 shell 不保证获得新值；如果窗口重载时 callback URI 发生变化，被持久化重连的 shell 也可能需要新建或重启终端；
- 本期不修改 Extension Host 的 `process.env`。

扩展提供 `Attentive: Show VS Code Callback Status` 诊断命令。命令只显示是否已注入和 URI scheme，不展示完整 URI。

## 6. CLI 行为

CLI 读取其依赖中传入的环境对象；生产环境默认为 `process.env`。

点击动作的选择顺序为：

1. 用户显式传入的 `--url`；
2. `ATTENTIVE_VSCODE_CALLBACK_URI`；
3. 无点击动作。

显式 `--url` 只接受 HTTP/HTTPS。环境回调 URI 接受协议层允许的 URI scheme。

如果环境变量缺失，CLI 正常发送普通通知。如果变量存在但为空、格式错误、scheme 不受支持或超过长度限制，CLI 向 stderr 输出 warning，忽略该值，并继续发送普通通知；退出码仍由通知请求结果决定。存在显式 `--url` 时，不解析也不诊断环境回调 URI。

## 7. Protocol

`NotificationRequest` 使用受控 action，替换原来的顶层 `url`：

```ts
interface OpenUriAction {
  type: "open-uri";
  uri: string;
}

interface NotificationRequest {
  title: string;
  body: string;
  source?: string;
  action?: OpenUriAction;
  metadata?: Record<string, unknown>;
}
```

允许的 URI scheme 为：

- `http:`；
- `https:`；
- `vscode:`。

URI 最大长度为 4096 个字符。拒绝 `file:`、`javascript:` 和其他任意 scheme。协议仍使用 `/api/v1/notifications`；项目尚处私有 `0.1.0`，不为未发布的旧请求模型保留双字段或 v2 端点。

CLI 的 `--url` 参数名称保持不变，但在内部转换为 `open-uri` action。

## 8. Notifier

Notifier 只理解 `open-uri`，不读取 callback 环境变量，也不解析 VS Code 的 window 参数。

Windows Toast 被点击时至多打开一次 action URI。打开 URI 不得经过 `cmd.exe`、PowerShell 或其他命令解释器，使用：

```text
explorer.exe <uri>
```

实现使用参数数组和 `shell: false`。协议校验和无 shell 打开方式共同构成安全边界。

## 9. 支持范围

首版产品只支持 VS Code Stable。实现不根据 Dev Container、WSL、SSH、Codespaces 等远程类型写分支，而是接受 `vscode.env.asExternalUri` 返回的完整 URI。

“设计兼容”不等于“已经验收”。正式支持范围以实际通过验收矩阵的环境为准。对尚未验收的环境不作端到端保证。

## 10. 安全与隐私

- callback URI 作为 opaque value 传递，不解析、重写或记录完整值；
- URI 中不主动加入 workspace、文件、终端、用户信息、自定义 token 或自定义 window ID；
- 诊断命令和日志不显示完整 callback URI；
- Notifier 只打开协议白名单内且长度合规的 URI；
- 点击处理必须去重，避免 callback 和 click event 导致重复打开；
- 环境变量可被终端子进程读取，因此不能把它当作身份认证凭据；
- 本设计不改变 Notifier 当前网络服务的认证边界。

## 11. 验收

### 11.1 自动化测试

- 扩展生成并注入 callback URI；
- handler 只接受 `/focus`；
- protocol 接受合法 action，拒绝非法 scheme、空 URI 和超长 URI；
- CLI 自动读取环境变量；
- 显式 `--url` 覆盖隐式 callback；
- 缺失 callback 时发送普通通知；
- 非法环境 callback 产生 warning，但成功发送时退出码仍为 0；
- Notifier 点击至多打开一次；
- Windows URI opener 使用 `explorer.exe`、参数数组和 `shell: false`。

### 11.2 人工验收

- 两个不同工作区窗口；
- 两个打开相同工作区的窗口；
- 两个空窗口；
- 新建终端和重启终端；
- 已存在终端不被错误宣称为已更新；
- 显式 `--url` 覆盖 callback；
- callback 缺失或非法时仍显示普通通知；
- 在每个准备宣称支持的 Remote 环境中验证 `asExternalUri` 返回值和端到端点击；
- 关闭来源窗口后点击通知，观察并保留 VS Code 原生行为；
- Windows 上真实 Toast 点击回到正确的 VS Code Stable 窗口。

## 12. 未来方向

非终端调用场景可能需要让其他扩展启动的 CLI 继承窗口上下文。届时可以评估在每个 Extension Host 中设置 `process.env`，或引入显式参数、context handle、登记文件或本地 broker。

这些方案的前提、传播路径和安全边界与集成终端不同。本期只记录方向，不实现、不预留未使用的 window ID/token 字段，也不把弱推断作为回退。
