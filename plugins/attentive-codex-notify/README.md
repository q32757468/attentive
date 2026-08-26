# Attentive Codex Notify

This Codex plugin sends a completed, non-empty Codex response to the configured
Attentive notifier when the `Stop` lifecycle event fires.

The plugin is self-contained: the hook configuration lives in `hooks/hooks.json`
and the notification runner lives in `scripts/attentive-codex-notify.js`.

## Install from this repository

```bash
codex plugin marketplace add /path/to/attentive
codex plugin add attentive-codex-notify@attentive-codex-plugins
```

After installing, review and trust the plugin hook with `/hooks` in a new Codex
thread.
