# Attentive for VS Code

Attentive connects notifications sent by the `attentive` CLI to the VS Code
window where the CLI was started. When a notification is clicked, Attentive
can bring that source window back into focus. Notifications from a focused
window can be suppressed by the CLI.

## Requirements

- VS Code 1.100.0 or newer
- The `attentive` CLI installed and available in the integrated terminal's
  `PATH`
- A supported Node.js runtime for the CLI (Node.js 18.18 or newer for the
  current Attentive workspace)

The extension itself does not display notifications and does not replace the
Attentive notifier. The CLI and notifier are separate components.

## Installation

Install **Attentive** from the VS Code Extensions view or from the Visual
Studio Marketplace. After installation, create a new integrated terminal or
restart the existing one before running `attentive`.

The endpoint contribution is cached by VS Code. In a normal single-window
reload, the reactivated extension listens on the same endpoint so restored
shells continue working without a restart.

## Usage

Run the CLI from an Attentive-enabled integrated terminal, for example:

```bash
attentive notify --title "Build complete" --body "The build finished"
```

Use the Command Palette and run **Attentive: Show VS Code Integration Status**
to check whether the per-window IPC server is listening, whether the window is
focused, and whether a callback URI is available.

The status command deliberately does not reveal the IPC endpoint or callback
URI.

## How it works

When the extension host starts, the extension creates one local IPC endpoint
for the VS Code window and contributes its opaque value to newly created
integrated terminals. Unix-like systems use a Unix socket; Windows uses a
randomized named pipe. The CLI reads the endpoint and asks the extension for
the current focus state and callback URI.

The Unix socket is created in a user-owned directory with restrictive
permissions and is removed when the extension is disposed. The endpoint is
local to the machine and is not sent to Attentive's servers.

If the IPC integration is unavailable, the CLI fails open and sends a normal
notification instead of suppressing it.

## Limitations and troubleshooting

- Restart the integrated terminal after installing the extension.
- If the status command reports that IPC is not listening, reload the VS Code
  window and restart the terminal.
- If a persisted endpoint cannot be validated or rebound, the extension falls
  back to a new endpoint and restored terminals must be restarted.
- Same-workspace multi-window use is unverified. Because VS Code caches the
  endpoint by workspace, restored terminals may disconnect or route to the
  wrong window; restart affected terminals if needed.
- Explicit notification URLs continue to take precedence over the callback
  supplied by the extension.
- The extension depends on the capabilities of the VS Code extension host and
  the terminal environment where the CLI runs. Test Remote SSH, WSL,
  containers, and other remote environments separately before relying on them.

For more implementation details, see the
[window context IPC specification](../../docs/SPEC/VSCODE_WINDOW_CONTEXT_IPC_SPEC.md)
and the [Attentive repository](https://github.com/q32757468/attentive).

## Privacy

Attentive does not include telemetry. This extension only exposes a local
window-context endpoint to the Attentive CLI through the integrated terminal
environment. It does not inspect workspace source files or send window context
to a remote service.

## License

MIT. See [LICENSE](LICENSE).
