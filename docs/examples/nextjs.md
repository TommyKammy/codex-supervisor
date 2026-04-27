# Next.js Starter Profile

Use [supervisor.config.nextjs.json](../../supervisor.config.nextjs.json) when the managed repo is a Next.js app that can expose an npm-owned install step and a single npm-owned pre-PR verification command.

## Copy the Profile

```bash
cp supervisor.config.nextjs.json supervisor.config.json
```

Replace these starter placeholders before the first run:

- `repoPath`: absolute path to the managed repository
- `repoSlug`: GitHub `owner/repo`
- `workspaceRoot`: directory where issue worktrees should be created
- `codexBinary`: `codex` or the path to the Codex executable

The copied profile remains invalid until those placeholders are replaced. Validate the edited config before running Codex:

```bash
node dist/index.js doctor --config <supervisor-config-path>
node dist/index.js status --config <supervisor-config-path> --why
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

## Expected npm Scripts

The starter profile sets:

```json
{
  "workspacePreparationCommand": "npm ci",
  "localCiCommand": "npm run verify:pre-pr"
}
```

`npm ci` is the worktree preparation command. It should succeed in a freshly created issue worktree.

`npm run verify:pre-pr` is the repo-owned local CI gate. It should be defined by the managed repo and return exit code `0` only when the app's pre-PR checks pass.

One common `package.json` shape is:

```json
{
  "scripts": {
    "build": "next build",
    "lint": "next lint",
    "test": "vitest run",
    "verify:pre-pr": "npm run lint && npm run test && npm run build"
  }
}
```

Do not assume every Next.js app defines all of these scripts. If your app has no test suite yet, keep `verify:pre-pr` to the repo-owned checks that actually exist, such as `npm run lint && npm run build`. If your app uses `pnpm`, `yarn`, or a custom task runner, replace `workspacePreparationCommand` and `localCiCommand` with the repo-owned commands before running the supervisor.

## First Issue Example

Create one small issue with the `codex` label before starting the loop:

<!-- nextjs-first-issue:start -->
```md
## Summary
Add a focused metadata test for the article page.

## Scope
- Add or tighten one test for the existing article page metadata behavior.
- Keep the page route, data model, and visual layout unchanged unless the test exposes a real defect.
- Do not add new runtime framework dependencies.

## Acceptance criteria
- The article page metadata keeps the expected title and description for a representative article fixture.
- The new or updated test is covered by the repo-owned pre-PR command.

## Verification
- npm run verify:pre-pr

Depends on: none
Parallelizable: No

## Execution order
1 of 1
```
<!-- nextjs-first-issue:end -->

Run the focused readiness checks before the first supervised pass:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
node dist/index.js run-once --config <supervisor-config-path> --dry-run
```
