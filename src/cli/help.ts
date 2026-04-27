export function renderCliHelp(): string {
  return `Usage:
  node dist/index.js [command] [options]
  node dist/index.js --help
  node dist/index.js help

Common flags:
  --config <supervisor-config-path>  Use an explicit supervisor config file.
  --dry-run                         Plan the next run-once or loop action without executing Codex.
  --why                             Include status decision details. Supported with status only.
  --suggest                         Print a copyable issue metadata skeleton. Supported with issue-lint only.
  --output <path>                   Write a sample issue body. Supported with sample-issue only.

First run:
  1. node dist/index.js init --dry-run --config <supervisor-config-path>
  2. node dist/index.js init --config <supervisor-config-path>
  3. node dist/index.js sample-issue
  4. node dist/index.js issue-lint <issue-number> --config <supervisor-config-path>
  5. node dist/index.js doctor --config <supervisor-config-path>
  6. node dist/index.js status --config <supervisor-config-path> --why
  7. node dist/index.js run-once --config <supervisor-config-path> --dry-run
  8. node dist/index.js run-once --config <supervisor-config-path>
  9. node dist/index.js loop --config <supervisor-config-path>

Run commands:
  run-once                          Run one supervisor cycle.
  loop                              Keep running supervisor cycles until stopped.

Inspect commands:
  init [--dry-run]                  Create or preview a starter supervisor config.
  status [--why]                    Show queue, PR, CI, review, and loop state.
  doctor                            Check local configuration and repository prerequisites.
  explain <issue-number>            Explain supervisor readiness for one issue.
  explain <issue-number> --timeline Show the issue-run evidence timeline.
  explain <issue-number> --audit-bundle
                                    Print a sanitized operator audit bundle.
  issue-lint <issue-number> [--suggest]
                                    Validate an execution-ready issue body.
  sample-issue [--output SAMPLE_ISSUE.md]
                                    Preview or write a standalone execution-ready issue body.
  readiness-checklist               Print the release-readiness checklist.

Repair commands:
  requeue <issue-number>            Requeue a blocked or failed issue.
  reset-corrupt-json-state          Move corrupt JSON state aside after inspection.

Maintenance commands:
  rollup-execution-metrics          Summarize execution metrics from durable state.
  summarize-post-merge-audits       Summarize post-merge audit patterns.
  prune-orphaned-workspaces         Remove orphaned managed workspaces.

Replay commands:
  replay <snapshot-path>            Replay one decision snapshot.
  replay-corpus [corpus-path]       Run checked-in replay corpus cases.
  replay-corpus-promote <snapshot-path> [case-id] [corpus-path]
                                    Promote a snapshot into the replay corpus.

Web-oriented commands:
  web                               Start the operator dashboard.
`;
}
