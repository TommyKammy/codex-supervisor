export function renderCliHelp(): string {
  return `Usage:
  node dist/index.js [command] [options]
  node dist/index.js --help
  node dist/index.js help

Common flags:
  --config <supervisor-config-path>  Use an explicit supervisor config file.
  --dry-run                         Plan the next run-once or loop action without executing Codex.
  --why                             Include status decision details. Supported with status only.

First run:
  1. node dist/index.js doctor --config <supervisor-config-path>
  2. node dist/index.js status --config <supervisor-config-path> --why
  3. node dist/index.js run-once --config <supervisor-config-path> --dry-run
  4. node dist/index.js run-once --config <supervisor-config-path>
  5. node dist/index.js loop --config <supervisor-config-path>

Run commands:
  run-once                          Run one supervisor cycle.
  loop                              Keep running supervisor cycles until stopped.

Inspect commands:
  status [--why]                    Show queue, PR, CI, review, and loop state.
  doctor                            Check local configuration and repository prerequisites.
  explain <issue-number>            Explain supervisor readiness for one issue.
  issue-lint <issue-number>         Validate an execution-ready issue body.
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
