# TypeScript and Node Starter Profile

Use [supervisor.config.typescript-node.json](../../supervisor.config.typescript-node.json) when the managed repo is a TypeScript or Node project that can expose an npm-owned setup command and an npm-owned pre-PR verification command.

## Copy the Profile

```bash
cp supervisor.config.typescript-node.json supervisor.config.json
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

`npm run verify:pre-pr` is the repo-owned local CI gate. It should be defined by the managed repo and return exit code `0` only when the repo's pre-PR checks pass.

One common `package.json` shape is:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test",
    "verify:pre-pr": "npm run build && npm run test"
  }
}
```

Do not assume every TypeScript/Node repo has these exact scripts. If your repo uses a different npm-owned setup or verification entrypoint, replace `workspacePreparationCommand` or `localCiCommand` with the repo-owned command before running the supervisor.

## First Issue Example

Create one small issue with the `codex` label before starting the loop:

```md
## Summary
Add one focused TypeScript test for the greeting formatter.

## Scope
- Add a narrow test for the existing greeting formatter behavior.
- Do not change production formatter behavior unless the test exposes a real defect.

## Acceptance criteria
- The formatter keeps existing output for a normal display name.
- The new test is covered by the repo-owned pre-PR command.

## Verification
- npm run verify:pre-pr

Depends on: none
Parallelizable: No

## Execution order
1 of 1
```

Run the focused readiness checks before the first supervised pass:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
node dist/index.js run-once --config <supervisor-config-path> --dry-run
```
