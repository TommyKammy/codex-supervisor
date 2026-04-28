# Issue Contract Template

Use this body for one standalone supervised issue. Keep the issue to one behavior delta and replace every placeholder before running issue-lint.

## Summary
<one-sentence behavior delta>

## Scope
- <in-scope change>
- <explicit non-goal or boundary>

## Acceptance criteria
- <observable outcome>
- <safety or regression boundary>

## Verification
- <focused test or command>
- <repo-owned local verification command>
- Run issue-lint before execution:

```bash
node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
```

Depends on: none
Parallelizable: No

## Execution order
1 of 1

Do not bypass issue-lint. If this issue becomes part of a sequenced parent, add `Part of: #<parent-issue-number>`, replace `Depends on: none` with the real blocking issue when one exists, and update `1 of 1` to the intended sequence position.
