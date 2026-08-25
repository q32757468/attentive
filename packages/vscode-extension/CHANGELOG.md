# Changelog

All notable changes to the Attentive VS Code extension are documented here.

## [0.1.3] - 2026-08-25

- Use a per-window local IPC endpoint for VS Code window context.
- Inject the endpoint into newly created and restarted integrated terminals.
- Add the `Attentive: Show VS Code Integration Status` command.
- Support callback URIs that return focus to the source VS Code window.
- Fail open when callback generation or IPC startup is unavailable.

## [0.1.2]

- Refine the VS Code callback integration.

## [0.1.1]

- Initial local VSIX packaging.
