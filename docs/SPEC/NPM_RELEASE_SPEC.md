# npm 自动发布规格

- 状态：已确认、已实现
- 日期：2026-08-25
- 目标仓库：`q32757468/attentive`
- 目标 registry：npm public registry

## 1. 目的

本规格定义 `@attentive-kit/cli` 的轻量自动发布流程。版本决策和正式发布时机均由维护者人工控制；GitHub Actions 只负责校验、构建、测试、打包和发布，不自动计算或修改版本号。

本流程不使用 Changesets，不在普通功能 PR 合并后自动发布，也不允许仅凭向 `main` push 或创建普通 Git tag 发布 npm 包。

## 2. 发布对象

唯一发布对象为：

| 包 | 目录 | 可见性 |
| --- | --- | --- |
| `@attentive-kit/cli` | `packages/cli` | public |

`@attentive-kit/protocol` 是 monorepo 内部源码包，不发布到 npm。CLI 将 protocol 的运行时代码和公开类型直接打入自身产物；CLI 的 npm manifest 中不得留下对 `@attentive-kit/protocol` 的 dependencies、peerDependencies 或 optionalDependencies 依赖。

CLI 版本与 GitHub Release tag 一一对应：

```text
@attentive-kit/cli  X.Y.Z
GitHub Release tag  vX.Y.Z
```

protocol 的 workspace 版本不参与 npm Release tag 校验，也不因 CLI 发布而要求同步升级。

## 3. 总体流程

```text
普通功能 PR
  │ 不修改发布版本
  ▼
维护者创建版本升级 PR
  │ 更新 CLI 版本
  ▼
审查并合并版本 PR
  │ main CI 通过
  ▼
维护者创建并发布 GitHub Release
  │ tag: vX.Y.Z，target: 版本 PR 的合并提交
  ▼
release.published 触发 GitHub Actions
  │ 校验 → 测试 → 构建 → 打包 → smoke test
  ▼
npm OIDC 发布 CLI
```

## 4. 版本升级 PR

### 4.1 创建时机

维护者在准备发布时人工创建版本升级 PR。普通功能、修复、文档和 CI PR 不负责发布版本管理。

### 4.2 PR 内容

版本 PR 必须：

- 将 `packages/cli/package.json` 的 `version` 更新为目标版本；
- 更新 lockfile 中由版本变化导致的必要内容；
- 按需更新 CHANGELOG 或 GitHub Release notes 的来源文档；
- 通过仓库常规 CI。

版本号遵循 SemVer。版本 PR 建议命名：

```text
release: vX.Y.Z
```

首版可以人工编辑 CLI 的 `package.json`。如果后续增加版本脚本，该脚本只负责修改版本和 lockfile，不得创建 GitHub Release 或直接发布 npm。

### 4.3 合并约束

版本 PR 必须先合并到 `main`。不得从尚未合并的分支、未审查的提交或本地工作区发布。

## 5. GitHub Release

### 5.1 创建方式

版本 PR 合并且 `main` CI 通过后，维护者在 GitHub 人工创建 Release：

```text
Tag:    vX.Y.Z
Target: main 上版本 PR 的合并提交
```

维护者可以先保存 Draft Release。只有点击 Publish release 才构成正式发布授权。

### 5.2 触发条件

发布 workflow 只监听：

```yaml
on:
  release:
    types: [published]
```

以下事件不得发布 npm：

- 向 `main` push；
- 普通 PR 合并；
- 仅创建或 push tag；
- 保存或修改 Draft Release；
- 手工重新运行一个版本不匹配的 workflow。

首版只支持正式版本。GitHub prerelease 或非 `vX.Y.Z` 格式 tag 必须失败，不得隐式发布到 `latest` 或其他 dist-tag。预发布版本及 `next` dist-tag 另行设计。

## 6. 发布前校验

Action 必须 checkout Release tag 对应的精确提交，而不是运行时最新的 `main`。

发布前必须完成以下校验：

1. Release tag 严格匹配 `vX.Y.Z`；
2. 从 tag 提取的版本严格等于 `packages/cli/package.json` 的 `version`；
3. Release 不是 draft 或 prerelease；
4. lockfile 未因安装、构建或打包产生未提交变化；
5. 目标 npm package name 和 registry 未被环境配置意外覆盖。

任一校验失败时，workflow 必须在执行任何 `npm publish` 前终止。

## 7. 构建与打包

发布 job 使用 GitHub-hosted Ubuntu runner、Node 24 和仓库声明的 pnpm 版本。安装必须使用冻结 lockfile，发布构建不得复用来源不明的依赖或构建产物缓存。

建议执行顺序：

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack（CLI）
tarball smoke test
```

必须发布 CI 当前运行生成的 tarball，不得直接发布仓库中已有的 `dist` 文件，也不得在发布后重新构建。

使用 pnpm 生成 CLI tarball。`@attentive-kit/protocol` 可以作为 workspace devDependency 参与本地构建，但构建配置必须将其实现和对外类型解析进 CLI 产物。例如源码中的：

```json
"devDependencies": {
  "@attentive-kit/protocol": "workspace:*"
}
```

不得在发布 tarball 的运行时依赖字段或生成的 JavaScript、类型声明中留下对该内部包的引用。随后使用 npm CLI 发布 tarball，以使用 npm 的 OIDC Trusted Publishing：

```text
npm publish <cli-tarball> --access public
```

### 7.1 Smoke test

发布前必须在新的临时目录中只安装本次生成的 CLI tarball，并至少验证：

```text
attentive --help
```

命令必须成功退出且输出 CLI usage。测试不能额外安装 `@attentive-kit/protocol`，也不能依赖 workspace symlink 或仓库内的 `node_modules`。

## 8. npm OIDC Trusted Publishing

正常发布不使用 `NPM_TOKEN`。Workflow 必须声明最小权限：

```yaml
permissions:
  contents: read
  id-token: write
```

发布 job 使用 GitHub Environment：

```text
npm
```

如仓库需要额外人工审批，应在该 Environment 上配置 deployment protection rule，而不是在 workflow 中引入长期 npm token。

npm 上的 CLI 包必须配置 Trusted Publisher：

```text
GitHub owner:      q32757468
GitHub repository: attentive
Workflow filename: publish-npm.yml
Environment:       npm
Allowed action:    npm publish
```

Workflow 文件名和 Environment 名必须与 npm 配置严格一致。包的 `repository.url` 必须准确指向本 GitHub 仓库。

发布环境必须满足 npm Trusted Publishing 的最低要求：

- npm CLI `>=11.5.1`；
- Node.js `>=22.14.0`；
- GitHub-hosted runner；
- `id-token: write`。

本规格选择 Node 24。通过 OIDC 发布 public package 时保留 npm 自动生成的 provenance，不显式关闭 provenance。

## 9. npm 包元数据

实现发布 workflow 前，CLI 包至少应具有：

- 正确的 `name` 和 `version`；
- 不存在 `private: true`；
- `license`；
- `repository`；
- `publishConfig.access: "public"`；
- 精确的 `files` 或其他发布内容白名单；
- 与实际产物一致的 `exports`、`types` 和 `bin`。

实现者必须通过 tarball 内容检查确认没有发布源码外的敏感文件、测试数据、缓存或本地配置。

protocol 必须保持内部包定位。实现时应使用 `private: true` 防止误发布；它不需要 npm 发布元数据、Trusted Publisher 或 GitHub Release。

## 10. 首次发布引导

`@attentive-kit/cli` 当前尚未存在于 npm。首次发布前必须先确认维护者拥有 npm 的 `@attentive-kit` scope；registry 返回名称不存在不代表当前账号拥有该 scope。

由于 Trusted Publisher 在 npm package settings 中配置，CLI 的首次创建属于一次性引导流程：

1. 确认或创建 npm `@attentive-kit` organization，并确认发布权限；
2. 使用维护者本地登录、2FA 或临时 granular access token，将 CLI 首次发布为 public；
3. 在 CLI package settings 中绑定 `publish-npm.yml` 和 `npm` Environment；
4. 运行一次后续版本的 OIDC 发布验证；
5. 验证成功后撤销临时 publish token，并可在 npm 中禁止传统 token 发布。

首次 scoped public publish 必须使用 `--access public`。首次引导不得把个人 token 提交到仓库、workflow、日志或长期 GitHub Secret。

## 11. 并发、失败与重试

发布 workflow 必须配置同一发布并发组，并设置 `cancel-in-progress: false`，防止两个 Release 并发发布或后一个发布取消前一个发布。

npm 的同名同版本不可覆盖。为使“npm 已发布成功但 workflow 后续步骤失败”的场景可安全重跑：

- workflow 在发布 CLI 前应查询该精确版本是否已存在；
- 版本不存在时正常发布；
- 版本已存在且 registry tarball integrity 与本次生成的 tarball 一致时跳过发布；
- 如果 registry 已存在的版本与当前 tarball 无法确认一致，workflow 必须失败并要求人工处理。

不得通过自动递增版本绕过失败，也不得在失败的 Release 上静默发布另一个版本。

## 12. 安全要求

- Release workflow 不执行来自 fork PR 的代码；
- workflow 依赖的第三方 Action 应固定到经过审查的 commit SHA，更新由单独 PR 完成；
- 发布 job 只授予 `contents: read` 和 `id-token: write`；
- 不输出 OIDC token、npm credential、完整用户级 `.npmrc` 或其他敏感配置；
- 不使用 self-hosted runner；
- 不从可变分支、未审查 artifact 或外部 URL 下载待发布 tarball；
- GitHub tag protection 和 `npm` Environment 审批可作为额外保护层。

## 13. 验收标准

### 13.1 自动化验收

- 非 `release.published` 事件不会发布；
- 非法 tag、prerelease、版本不一致均在 publish 前失败；
- workspace 通过 typecheck、test 和 build；
- CLI tarball 内容符合白名单；
- CLI tarball 的运行时依赖中不存在 `@attentive-kit/protocol`；
- CLI tarball 的 JavaScript 和类型声明中不存在对 `@attentive-kit/protocol` 的外部引用；
- 在空临时目录只安装 CLI tarball 后，`attentive --help` 成功；
- OIDC 发布不依赖 `NPM_TOKEN`；
- 重跑已经完成 npm publish 的 Release 时不会尝试覆盖已存在版本；
- 发布成功后，npm 上的 CLI 版本与 Release tag 一致。

### 13.2 人工验收

- GitHub Release 清楚展示版本和变更说明；
- npm 页面显示 CLI 为 public；
- npm 页面显示正确 repository；
- public GitHub repository 场景下显示 provenance；
- 全新环境可以安装 CLI 并运行 `attentive --help`；
- OIDC 验证完成后，临时首次发布 token 已撤销。

## 14. 非目标

首版不实现：

- Changesets；
- 自动生成或提交版本升级 PR；
- 从 Conventional Commits 自动推断版本；
- 每次 `main` push 自动发布；
- 发布 `@attentive-kit/protocol`；
- prerelease、canary、nightly 或 `next` dist-tag；
- npm staged publishing；
- 自动回滚或覆盖已发布 npm 版本。
