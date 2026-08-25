# Attentive for VS Code

This workspace extension starts a per-window local HTTP/JSON context server over a Unix socket or Windows named pipe and injects its opaque endpoint into newly created or restarted integrated terminals.

After installing the local VSIX, create or restart the terminal before invoking `attentive`. Existing running shells are not modified; a stale endpoint in a restored shell fails open and does not suppress notifications.

Run **Attentive: Show VS Code Integration Status** to see whether the IPC server is listening, the current focus state, and whether a callback is available. The command deliberately does not reveal the endpoint or callback URI.
