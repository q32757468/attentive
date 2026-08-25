# VS Code Marketplace 发布待办

本文记录 Attentive VS Code 扩展发布到 Visual Studio Code Marketplace 前仍需处理的事项。

## 尚未完成

- [x] 已加入 PNG 扩展图标 `packages/vscode-extension/assets/icon.png`，并在
      `packages/vscode-extension/package.json` 中配置 `icon` 字段及 `files` 白名单。
- [ ] 在 Visual Studio Marketplace / Azure DevOps 注册 Publisher，确认 publisher ID
      `attentive` 可用；如果不可用，需要同步修改 manifest 中的 `publisher`。
- [ ] 决定发布认证方式：短期手动发布可使用 Marketplace 要求的凭据；持续集成发布应配置
      Microsoft Entra ID 的安全自动化认证。
- [x] 已通过 Visual Studio Marketplace 查询确认扩展名称 `attentive-vscode` 未被占用；仍需确定公开发布版本号。
- [ ] 评估将 `activationEvents: ["*"]` 改为 `onStartupFinished`，验证不会影响终端环境变量注入，
      从而移除 `--allow-star-activation`。
- [ ] 在干净环境中验证 `pnpm --dir packages/vscode-extension run package:vsix`，并安装生成的 VSIX
      做实际验收。
- [ ] 至少验收 Windows、Linux、macOS，以及本地窗口、Remote SSH、WSL 和开发容器场景。
- [ ] 发布前确认 Marketplace 页面上的描述、分类、仓库链接、许可证和支持入口均正确。

## 当前已完成

- [x] 移除扩展 manifest 中的 `private: true`。
- [x] 完善 Marketplace README，包含安装、使用、工作原理、限制、故障排查和隐私说明。
- [x] 增加 `CHANGELOG.md` 和 `SUPPORT.md`，并将它们加入 VSIX 文件白名单。
- [x] 构建、类型检查和扩展测试通过。
- [x] VSIX 打包验证通过。

## 发布命令参考

在完成 Publisher 和认证配置后，可从扩展目录执行：

```bash
pnpm run build
pnpm exec vsce publish --no-dependencies --allow-star-activation
```

如果后续改用 `onStartupFinished`，应一并移除命令中的
`--allow-star-activation`。
