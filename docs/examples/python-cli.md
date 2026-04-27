# Python and CLI Starter Profile

Use [supervisor.config.python-cli.json](../../supervisor.config.python-cli.json) when the managed repo is a Python package, Python application, or general CLI tool that does not have a repo-wide npm contract.

## Copy the Profile

```bash
cp supervisor.config.python-cli.json supervisor.config.json
```

Replace these starter placeholders before the first run:

- `repoPath`: absolute path to the managed repository
- `repoSlug`: GitHub `owner/repo`
- `workspaceRoot`: directory where issue worktrees should be created
- `codexBinary`: `codex` or the path to the Codex executable
- `workspacePreparationCommand`: the repo-owned setup command for a fresh issue worktree
- `localCiCommand`: the repo-owned pre-PR verification command

The copied profile remains invalid until those placeholders are replaced. Validate the edited config before running Codex:

```bash
node dist/index.js doctor --config <supervisor-config-path>
node dist/index.js status --config <supervisor-config-path> --why
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

## Substitute Repo-Owned Commands

The starter profile sets:

```json
{
  "workspacePreparationCommand": "<replace-with-repo-owned-setup-command>",
  "localCiCommand": "<replace-with-repo-owned-pre-pr-command>"
}
```

Replace `workspacePreparationCommand` with the command your repo owns for preparing a fresh worktree. Common examples include:

```bash
python -m pip install -e ".[dev]"
python -m pip install -r requirements-dev.txt
uv sync --dev
```

Replace `localCiCommand` with the command your repo owns as the pre-PR gate. Common examples include:

```bash
python -m pytest
python -m pytest && python -m build
python -m unittest
```

Do not assume every Python package or CLI tool uses these commands. If your repo uses `tox`, `nox`, `hatch`, `poetry`, `uv`, `make`, or another task runner, substitute the repo-owned setup and verification commands before running the supervisor.

Keep `localCiCommand` fail closed: it should return exit code `0` only when the repo's checks are ready for PR progression.

## First Issue Example

Create one small issue with the `codex` label before starting the loop:

<!-- python-cli-first-issue:start -->
```md
## Summary
Add a focused CLI test for the version flag.

## Scope
- Add or tighten one test for the existing `--version` CLI behavior.
- Keep command names, packaging metadata, and runtime dependencies unchanged unless the test exposes a real defect.
- Do not change release or publishing behavior.

## Acceptance criteria
- The CLI version flag keeps returning the expected version string or package metadata value.
- The new or updated test is covered by the repo-owned pre-PR command.

## Verification
- python -m pytest

Depends on: none
Parallelizable: No

## Execution order
1 of 1
```
<!-- python-cli-first-issue:end -->

Run the focused readiness checks before the first supervised pass:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
node dist/index.js run-once --config <supervisor-config-path> --dry-run
```
