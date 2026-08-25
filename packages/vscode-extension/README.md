# Attentive for VS Code

This workspace extension injects a window-specific Attentive callback URI into newly created or restarted integrated terminals and keeps the contribution available when VS Code restores terminals after a window reload.

After installing the local VSIX, create or restart the terminal before invoking `attentive`. Existing running shells are not modified; VS Code can reuse the persisted contribution when it restores terminals after a window reload.

Run **Attentive: Show VS Code Callback Status** to see whether injection succeeded. The command deliberately does not reveal the callback URI.
