# npm 发布操作手册

本文档用于首次发布 `@attentive-kit/cli`，并验证后续通过 GitHub Actions 和 npm Trusted Publishing（OIDC）自动发布。

配套文件：

- 发布规格：[`docs/SPEC/NPM_RELEASE_SPEC.md`](./SPEC/NPM_RELEASE_SPEC.md)
- 发布工作流：[`.github/workflows/publish.yml`](../.github/workflows/publish.yml)
- CLI manifest：[`packages/cli/package.json`](../packages/cli/package.json)

> npm 的同名同版本不可覆盖。执行发布命令前，请逐项确认版本、commit 和 tarball；任何一步出现不符合预期的结果都应先停止排查。

## 第一阶段：推送当前实现

### 1. 检查待推送的 commit

- [ ] 查看本地 `main` 相对远端包含哪些 commit：

  ```bash
  git log --oneline origin/main..main
  ```

- [ ] 确认工作区没有未提交修改：

  ```bash
  git status --short
  ```

  预期没有输出。

- [ ] 推送到 GitHub：

  ```bash
  git push origin main
  ```

- [ ] 打开 GitHub 仓库，确认 `.github/workflows/publish.yml` 已存在于 `main`。

## 第二阶段：配置 GitHub Environment

### 2. 创建 `npm` Environment

- [ ] 打开 GitHub 仓库：

  ```text
  Settings → Environments → New environment
  ```

- [ ] Environment 名称严格填写：

  ```text
  npm
  ```

- [ ] 按需配置 Required reviewers。
- [ ] 不添加 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN` secret。

Environment 名称区分配置值，必须与 `publish.yml` 和 npm Trusted Publisher 中的 `npm` 完全一致。

参考：[GitHub Environments 官方文档](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments)

## 第三阶段：准备 npm 账号和 scope

### 3. 确认 npm 账号安全设置

- [ ] 登录 [npmjs.com](https://www.npmjs.com/)。
- [ ] 确认账号已启用 2FA。
- [ ] 保存好 2FA 恢复码。

### 4. 确认 `@attentive-kit` scope

- [ ] 确认 npm 上已经创建 `attentive-kit` organization，或确认该 scope 属于正确账号。
- [ ] 确认当前 npm 账号拥有创建和发布 public package 的权限。

可以先执行：

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

检查包当前是否存在：

```bash
npm view @attentive-kit/cli@0.1.0 --registry=https://registry.npmjs.org/
```

首次发布前预期返回 `E404`。注意：`E404` 只说明包不存在，不能证明当前账号拥有 `@attentive-kit` scope。

参考：

- [创建和发布 scoped public package](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [npm 发布与 2FA 要求](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)

## 第四阶段：首次人工发布 `0.1.0`

npm package 创建前没有 package settings 页面，因此无法提前绑定 Trusted Publisher。`0.1.0` 需要人工发布一次作为引导。

### 5. 确认发布来源

- [ ] 切换到 `main` 并同步远端：

  ```bash
  git switch main
  git pull --ff-only origin main
  ```

- [ ] 确认工作区干净：

  ```bash
  git status --short
  ```

- [ ] 记录准备发布的 commit：

  ```bash
  git rev-parse HEAD
  ```

  保存该 SHA，后面创建 `v0.1.0` GitHub Release 时需要选择这个 commit。

- [ ] 确认 CLI 版本：

  ```bash
  node -p "require('./packages/cli/package.json').version"
  ```

  预期输出：

  ```text
  0.1.0
  ```

### 6. 安装、检查和构建

- [ ] 执行完整检查：

  ```bash
  corepack enable
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm test
  pnpm build
  ```

- [ ] 确认 lockfile 和其他文件没有被意外修改：

  ```bash
  git status --short
  ```

  预期没有输出。如果有输出，先停止发布并确认原因。

### 7. 生成并检查 tarball

- [ ] 创建临时目录并执行 `pnpm pack`：

  ```bash
  release_dir="$(mktemp -d)"
  pnpm --dir packages/cli pack --pack-destination "$release_dir"
  cli_tarball="$release_dir/attentive-kit-cli-0.1.0.tgz"
  test -f "$cli_tarball"
  ```

- [ ] 查看 tarball 内容：

  ```bash
  tar -tzf "$cli_tarball"
  ```

  预期只包含：

  ```text
  package/package.json
  package/dist/*
  ```

- [ ] 在空目录安装并执行 smoke test：

  ```bash
  smoke_dir="$(mktemp -d)"
  (
    cd "$smoke_dir"
    npm init --yes >/dev/null
    npm install --ignore-scripts "$cli_tarball"
    ./node_modules/.bin/attentive --help
  )
  ```

  预期输出以此开头：

  ```text
  Usage: attentive notify [options]
  ```

### 8. 人工发布 tarball

- [ ] 再次确认 npm 登录账号：

  ```bash
  npm whoami --registry=https://registry.npmjs.org/
  ```

- [ ] 发布 public scoped package：

  ```bash
  npm publish "$cli_tarball" \
    --access public \
    --registry=https://registry.npmjs.org/
  ```

  按提示完成 2FA。不要把密码、OTP、npm token 或用户级 `.npmrc` 内容粘贴到 issue、PR 或日志中。

- [ ] 验证 npm 页面和 CLI：

  ```bash
  npm view @attentive-kit/cli@0.1.0 --registry=https://registry.npmjs.org/
  npx @attentive-kit/cli@0.1.0 --help
  ```

## 第五阶段：绑定 npm Trusted Publisher

### 9. 配置 OIDC 信任关系

- [ ] 打开 npm package 设置：

  ```text
  @attentive-kit/cli → Settings → Trusted publishing
  ```

- [ ] 选择 GitHub Actions，并严格填写：

  ```text
  Organization or user: q32757468
  Repository:           attentive
  Workflow filename:    publish.yml
  Environment:          npm
  Allowed actions:      npm publish
  ```

`Workflow filename` 只填写 `publish.yml`，不要填写 `.github/workflows/publish.yml`。

- [ ] 保存配置并重新打开页面，确认字段无误。

参考：[npm Trusted Publishing 官方文档](https://docs.npmjs.com/trusted-publishers/)

## 第六阶段：补建 `v0.1.0` GitHub Release

### 10. 为首次人工发布建立对应 Release

- [ ] 打开：

  ```text
  GitHub repository → Releases → Draft a new release
  ```

- [ ] 填写：

  ```text
  Tag:        v0.1.0
  Target:     第 5 步记录的 commit
  Prerelease: 不勾选
  ```

- [ ] 填写 Release notes。
- [ ] 点击 `Publish release`。
- [ ] 如果 `npm` Environment 配置了 reviewer，在 Actions 页面批准 deployment。

`publish.yml` 会重新构建 tarball。因为 `0.1.0` 已经人工发布：

- registry integrity 与当前 tarball 相同：安全跳过 `npm publish`，workflow 成功；
- integrity 不同或无法确认：workflow 失败，此时不要尝试覆盖版本，应先排查构建差异。

这一步不会真正验证 OIDC 发布，因为相同版本已经存在。

## 第七阶段：使用 `0.1.1` 验证 OIDC 发布

### 11. 创建版本升级 PR

- [ ] 创建分支：

  ```bash
  git switch -c release/v0.1.1
  ```

- [ ] 将 `packages/cli/package.json` 中的版本改为：

  ```json
  "version": "0.1.1"
  ```

- [ ] 更新 lockfile 并执行检查：

  ```bash
  pnpm install
  pnpm typecheck
  pnpm test
  pnpm build
  ```

- [ ] 提交版本 PR：

  ```bash
  git add packages/cli/package.json pnpm-lock.yaml
  git commit -m "release: v0.1.1"
  git push -u origin release/v0.1.1
  ```

如果 `pnpm-lock.yaml` 没有变化，不需要强行提交它。

- [ ] 创建 PR、完成审查并合并到 `main`。
- [ ] 记录版本 PR 合并后的 commit SHA。

当前仓库暂未配置单独的常规 CI workflow，因此合并前必须确认上述本地检查全部通过；未来增加 CI 门禁后，应等待 required checks 通过再合并。

### 12. 发布 `v0.1.1` GitHub Release

- [ ] 创建正式 GitHub Release：

  ```text
  Tag:        v0.1.1
  Target:     版本 PR 合并后的 commit
  Prerelease: 不勾选
  ```

- [ ] 点击 `Publish release`。
- [ ] 在 Actions 页面观察 `Publish CLI to npm` workflow。
- [ ] 如 Environment 要求审批，确认版本和 commit 后批准。
- [ ] 确认所有校验及 `npm publish` 步骤成功。

### 13. 验证 OIDC 发布结果

- [ ] 查询 npm：

  ```bash
  npm view @attentive-kit/cli@0.1.1 --registry=https://registry.npmjs.org/
  ```

- [ ] 通过 npx 执行：

  ```bash
  npx @attentive-kit/cli@0.1.1 --help
  ```

- [ ] 在 npm package 页面确认：
  - package 为 public；
  - repository 指向 `q32757468/attentive`；
  - public GitHub repository 场景下显示 provenance。

- [ ] 如果首次引导使用过临时 granular token，立即撤销该 token。
- [ ] 确认 GitHub repository/environment 中没有长期 `NPM_TOKEN`。

## 后续常规发布

OIDC 验证成功后，每次发布只需要：

1. 创建版本升级 PR，只更新 CLI 版本及必要的 lockfile/Release notes；
2. 执行 typecheck、test 和 build；
3. 审查并合并到 `main`；
4. 创建与版本严格对应的正式 GitHub Release；
5. 等待 `publish.yml` 完成；
6. 使用 `npm view` 和 `npx` 验证。

不得通过以下方式发布：

- 仅 push tag；
- 直接向 `main` push 后等待自动发布；
- 创建 prerelease；
- 自动修改版本绕过失败；
- 使用相同版本覆盖 npm 上已有包；
- 给 workflow 添加长期 `NPM_TOKEN`。

## 常见失败处理

### npm 返回 scope 或权限错误

确认 `@attentive-kit` organization 存在，且 `npm whoami` 对应账号拥有 publish 权限。包名返回 `E404` 不代表拥有 scope。

### OIDC/Trusted Publisher 校验失败

逐项比较 npm package settings 与 workflow：

```text
Owner:       q32757468
Repository:  attentive
Workflow:    publish.yml
Environment: npm
Action:      npm publish
```

同时确认 workflow 使用 GitHub-hosted runner，并具有 `id-token: write`。

### npm 已存在相同版本但 integrity 不同

立即停止。不要重新发布、覆盖或自动递增版本。保留 Action 日志和本地 tarball，确认首次人工发布是否来自同一 commit、同一构建流程。

### Release tag 与 package 版本不一致

不要修改现有 Release 来发布另一个版本。确认版本 PR 已合并，然后为正确版本创建对应 Release。
