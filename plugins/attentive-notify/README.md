# Attentive Notify

This plugin sends a completed, non-empty response from Codex or Claude Code to
the configured Attentive notifier when the `Stop` lifecycle event fires.

This directory is the plugin root:

```text
.codex-plugin/plugin.json       # Codex manifest
.claude-plugin/plugin.json      # Claude Code manifest
hooks/hooks.json                # shared Stop hook
scripts/                        # shared hook implementation
```

The repository uses `../../.claude-plugin/marketplace.json` as its single
marketplace catalog. Claude Code reads it directly, and Codex supports it for
compatibility; it points to this plugin directory.

The hook uses `${CLAUDE_PLUGIN_ROOT}`, which is understood by Claude Code and
provided by Codex for compatibility.

## Install in Codex

```bash
codex plugin marketplace add https://github.com/q32757468/attentive
codex plugin add attentive-notify@attentive
```

After installing, review and trust the plugin hook with `/hooks` in a new Codex
thread.

## Install in Claude Code

```text
/plugin marketplace add q32757468/attentive
/plugin install attentive-notify@attentive
```

For a local checkout, replace the GitHub repository with its absolute path in
both marketplace-add commands.
