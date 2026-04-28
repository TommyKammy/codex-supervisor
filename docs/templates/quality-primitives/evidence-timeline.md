# Evidence Timeline Template

Use this template when recording durable run evidence for audit, recovery, or handoff.

## Event

- Issue: `#<issue-number>`
- Branch: `<branch-name>`
- Head SHA: `<head-sha>`
- Phase: `<supervisor-phase>`
- Actor: `<operator-or-agent>`
- Timestamp: `<iso-8601-timestamp>`

## Evidence

- Issue-lint: `<passed-or-failed-and-command>`
- Focused verification: `<passed-or-failed-and-command>`
- Local CI: `<passed-or-failed-and-command-or-not-configured>`
- Build: `<passed-or-failed-and-command-or-not-run>`
- Review boundary: `<not-started-draft-ready-blocked-or-approved>`
- Path hygiene: `<passed-or-failed-and-command>`

## Outcome

- State hint: `<supervisor-state-hint>`
- Failure signature: `<stable-failure-signature-or-none>`
- Blocked reason: `<blocked-reason-or-none>`
- Next action: `<next-action>`

Keep timeline entries tied to directly observed facts. Do not infer repository, issue, PR, tenant, or environment linkage from naming conventions or nearby comments.
