# Changelog

All notable changes to the Attentive VS Code extension are documented here.

## [Unreleased]

## [0.1.10] - 2026-08-27

- Update the extension icon with tighter framing and approximately 10% side
  margins while retaining the 128×128 canvas size.

## [0.1.9] - 2026-08-26

- Reuse the persisted per-window IPC endpoint across normal VS Code window
  reloads so restored terminals remain connected.

## [0.1.7] - 2026-08-25

- Bump the extension version to ensure VS Code recognizes the refreshed package as an update.

## [0.1.6] - 2026-08-25

- Reduce the extension icon to a compact 128×128 PNG for faster packaging and clearer rendering.

## [0.1.5] - 2026-08-25

- Bump the extension version to ensure the tightened icon is recognized as an update.

## [0.1.4] - 2026-08-25

- Tighten the extension icon artwork to improve visibility in the VS Code extensions view.

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
