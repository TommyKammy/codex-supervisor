# Operator Actions Template

Use this template to document the operator action vocabulary for a supervised repo. Keep action names stable enough for status output, dashboards, and external automation to route without scraping prose.

## Action vocabulary

| Action | Meaning | Required evidence |
| --- | --- | --- |
| `continue` | No blocking operator action is required. | `<current-state-evidence>` |
| `fix_config` | Required setup, trust posture, workspace preparation, or local CI config is missing or invalid. | `<config-or-doctor-evidence>` |
| `adopt_local_ci` | A repo-owned local CI candidate exists but is not configured. | `<candidate-command>` |
| `dismiss_local_ci` | The operator intentionally leaves local CI unset for this profile. | `<dismissal-record>` |
| `manual_review` | Human review is required before the lane can continue. | `<review-evidence>` |
| `repair_verification` | Focused verification or local CI failed and tracked content needs repair. | `<failure-command-and-signature>` |
| `restart_loop` | The supervisor loop must be restarted or resumed by the operator. | `<loop-runtime-state>` |

## Rules

- Operator action output is a routing surface, not an authorization bypass.
- Actions must point to the authoritative blocking record or command result.
- Do not widen an action from one issue, PR, branch, review, or config profile to a sibling record unless there is an explicit authoritative link.
- Do not mark a blocked state as `continue` because the summary text looks healthy.
