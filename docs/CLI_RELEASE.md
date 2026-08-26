# CLI 发布

`@attentive-kit/cli` 通过正式 GitHub Release 发布到 npm。Release 发布后，
[`publish-cli.yml`](../.github/workflows/publish-cli.yml) 会自动校验、构建、测试，并通过 npm Trusted Publishing 发布包。

## 发布步骤

1. 从最新的 `main` 创建发布分支，将 [`packages/cli/package.json`](../packages/cli/package.json) 中的 `version` 更新为目标版本：

   ```bash
   git switch main
   git pull --ff-only origin main
   git switch -c release/cli-vX.Y.Z
   pnpm install
   pnpm typecheck
   pnpm test
   pnpm build
   ```

   如果 `pnpm-lock.yaml` 有变化，需要一并提交。

2. 提交版本变更，创建 PR 并合并到 `main`。

3. 在 GitHub 仓库的 **Releases → Draft a new release** 中创建 Release：

   - Tag：`cli-vX.Y.Z`，版本必须与 `packages/cli/package.json` 完全一致；
   - Target：版本 PR 合并到 `main` 后的 commit；
   - 不勾选 **Set as a pre-release**；
   - 填写 Release notes，然后点击 **Publish release**。

4. 在 GitHub Actions 中等待 **Publish CLI to npm** workflow 完成。如果 `npm` Environment 要求审批，核对 tag 和 commit 后批准。

5. 验证 npm 包：

   ```bash
   npm view @attentive-kit/cli@X.Y.Z --registry=https://registry.npmjs.org/
   npx @attentive-kit/cli@X.Y.Z --help
   ```

## 注意事项

- 只有发布正式 GitHub Release 才会触发 npm 发布；仅 push tag 不会发布。
- 不要直接运行 `npm publish`，也不要在 workflow 中添加 `NPM_TOKEN`。
- npm 上的同名同版本不能覆盖。若 workflow 提示已存在版本的 tarball 不一致，应停止发布并排查，不要改写或重发该版本。
- Release tag 格式必须是稳定版本 `cli-vX.Y.Z`，当前流程不支持 prerelease。
