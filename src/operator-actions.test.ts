import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildStatusOperatorCockpitViewModel,
  operatorActionVocabulary,
  parseOperatorActionLine,
  type RestartRecommendation,
  selectRestartRecommendation,
  selectStatusOperatorAction,
  validOperatorActions,
} from "./operator-actions";
import { operatorActionDashboardTitles } from "./backend/webui-dashboard-browser-logic";

interface PublishedOperatorActionVocabulary {
  contractName: string;
  contractVersion: number;
  canonicalSource: string;
  actions: Array<{
    action: string;
    surfaces: string[];
    meaning: string;
  }>;
}

const operatorActionContractPath = resolve(process.cwd(), "docs/operator-actions.schema.json");

function readPublishedOperatorActionVocabulary(): PublishedOperatorActionVocabulary {
  return JSON.parse(readFileSync(operatorActionContractPath, "utf8")) as PublishedOperatorActionVocabulary;
}

function sortedTokens(tokens: Iterable<string>): string[] {
  return [...tokens].sort((left, right) => left.localeCompare(right));
}

function requireRestartRecommendation(recommendation: RestartRecommendation | null): RestartRecommendation {
  if (recommendation === null) {
    assert.fail("expected a restart recommendation");
  }
  return recommendation;
}

test("selectRestartRecommendation classifies every restart recommendation category from shared status lines", () => {
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
      ],
    })).category,
    "safe_restart",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=addressing_review first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=inspect_runtime",
      ],
    })).category,
    "restart_required_for_convergence",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=active_tracked_work_blocker state=addressing_review reason=loop_off",
      ],
    })).category,
    "restart_required_for_convergence",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#189 classification=stale_but_recoverable state=blocked reason=stale_review_bot",
      ],
    })).category,
    "restart_required_for_convergence",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=manual_review_required state=blocked reason=manual_review",
      ],
    })).category,
    "manual_review_before_restart",
  );
});

test("published operator action artifact matches the typed vocabulary", () => {
  const contract = readPublishedOperatorActionVocabulary();

  assert.equal(contract.contractName, "codex-supervisor.operator-actions");
  assert.equal(contract.contractVersion, 1);
  assert.equal(contract.canonicalSource, "src/operator-actions.ts");
  assert.deepEqual(contract.actions, operatorActionVocabulary);
  assert.deepEqual(sortedTokens(Object.keys(validOperatorActions)), sortedTokens(operatorActionVocabulary.map((entry) => entry.action)));
});

test("operator action docs and WebUI labels cannot reference tokens outside the shared vocabulary", () => {
  const vocabulary = new Set<string>(operatorActionVocabulary.map((entry) => entry.action));
  const docs = readFileSync(resolve(process.cwd(), "docs/getting-started.md"), "utf8");
  const documentedTokens = [
    ...docs.matchAll(/\b(?:operator_action|doctor_operator_action) action=([a-z0-9_]+)/gu),
  ].map((match) => match[1]);

  assert.ok(documentedTokens.length > 0, "getting-started docs should include operator action examples");
  assert.deepEqual(
    documentedTokens.filter((token) => !vocabulary.has(token)),
    [],
    "docs must not document action tokens outside src/operator-actions.ts",
  );
  assert.deepEqual(
    sortedTokens(Object.keys(operatorActionDashboardTitles)),
    sortedTokens(vocabulary),
    "WebUI operator action titles must cover the shared action vocabulary exactly",
  );
});

test("parseOperatorActionLine reads rendered status and doctor action lines", () => {
  const expected = {
    action: "fix_config",
    source: "tracked_pr_host_local_ci",
    priority: 80,
    summary:
      "Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
  };

  assert.deepEqual(
    parseOperatorActionLine(
      "operator_action action=fix_config source=tracked_pr_host_local_ci priority=80 summary=Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
    ),
    expected,
  );

  assert.deepEqual(
    parseOperatorActionLine(
      "doctor_operator_action action=fix_config source=tracked_pr_host_local_ci priority=80 summary=Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
    ),
    expected,
  );

  assert.equal(parseOperatorActionLine("operator_action action=unknown source=status priority=0 summary=nope"), null);
  assert.equal(parseOperatorActionLine("doctor_operator_action action=unknown source=doctor priority=0 summary=nope"), null);
  assert.equal(parseOperatorActionLine("operator_action action=fix_config source=status priority=80foo summary=nope"), null);
});

test("selectStatusOperatorAction ignores rendered doctor action lines", () => {
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "doctor_operator_action action=fix_config source=doctor_check priority=80 summary=Doctor found a failing host prerequisite; fix the reported check before continuing supervisor operation.",
        "operator_action action=continue source=status priority=0 summary=No blocking operator action was detected; continue normal supervisor operation.",
      ],
    }),
    {
      action: "continue",
      source: "status",
      priority: 0,
      summary: "No blocking operator action was detected; continue normal supervisor operation.",
    },
  );
});

test("selectStatusOperatorAction flags elapsed Codex review request fallback instead of continuing", () => {
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "codex_connector_review_fallback status=timeout_elapsed provider=codex current_head_sha=head-1 current_head_observed_at=none required_checks_green_at=2026-05-19T09:03:41Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion wait_until=2026-05-19T09:13:41.000Z",
        "codex_connector_convergence status=stale_review_commit_residue provider=codex current_head_sha=head-1 current_head_observed_at=none latest_signal_head_sha=head-0 highest_severity=none finding_count=0 merge_effect=blocked next_action=request_current_head_review stale_review_commit_threads=1 stale_review_commit_thread_ids=thread-1",
      ],
    }),
    {
      action: "provider_outage_suspected",
      source: "codex_connector_review_fallback",
      priority: 70,
      summary:
        "The configured review provider has not reported on the current head after checks turned green; wait, verify provider delivery, or escalate to manual review.",
    },
  );
});

test("selectStatusOperatorAction flags request-eligible Codex recovery instead of continuing", () => {
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=head-1 current_head_observed_at=none required_checks_green_at=2026-05-19T09:03:41Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=2026-05-19T09:13:41.000Z",
        "tracked_pr_mismatch issue=#169 pr=#177 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes",
      ],
      contextLines: ["selected_issue=#169"],
    }),
    {
      action: "provider_outage_suspected",
      source: "codex_connector_review_fallback",
      priority: 70,
      summary:
        "A current-head Codex Connector review request is eligible; run the selected supervisor cycle to post or record it.",
    },
  );

  assert.equal(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "tracked_pr_mismatch issue=#169 pr=#177 recoverability=stale_but_recoverable github_state=ready_to_merge github_blocked_reason=none local_state=blocked local_blocked_reason=manual_review stale_local_blocker=yes",
      ],
      contextLines: ["selected_issue=#169"],
    }).action,
    "manual_review",
  );
});

test("buildStatusOperatorCockpitViewModel carries the shared action contract and evidence", () => {
  assert.deepEqual(
    buildStatusOperatorCockpitViewModel({
      detailedStatusLines: [
        "tracked_pr_host_local_ci issue=#1783 gate=local_ci blocked_reason=workspace_environment remediation_target=workspace_environment",
        "trust_mode=trusted_repo_and_authors execution_safety_mode=operator_gated",
      ],
      whyLines: ["selected_issue=#1783"],
    }),
    {
      action: {
        action: "fix_config",
        source: "tracked_pr_host_local_ci",
        priority: 80,
        summary:
          "Host-local CI could not run because the workspace environment is missing prerequisites; fix configuration or workspace preparation before continuing.",
      },
      currentTaskContract: "selected_issue=#1783",
      trustPosture: "trust_mode=trusted_repo_and_authors execution_safety_mode=operator_gated",
      gateState: "gate=local_ci remediation_target=workspace_environment",
      blockingReason: "workspace_environment",
      evidence: [
        "tracked_pr_host_local_ci issue=#1783 gate=local_ci blocked_reason=workspace_environment remediation_target=workspace_environment",
      ],
      fallbackCommand: "node dist/index.js doctor --config <supervisor-config-path>",
    },
  );
});

test("buildStatusOperatorCockpitViewModel prefers whyLines for the current task contract", () => {
  assert.equal(
    buildStatusOperatorCockpitViewModel({
      detailedStatusLines: ["selected_issue=#1777"],
      whyLines: ["selected_issue=#1783"],
    }).currentTaskContract,
    "selected_issue=#1783",
  );
});

test("selectRestartRecommendation stays quiet for completed no-active tracked records", () => {
  assert.equal(
    selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=safe_to_ignore state=done reason=terminal_done",
      ],
    }),
    null,
  );
  assert.equal(
    selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#189 classification=stale_already_handled state=done reason=merged_pr_convergence",
      ],
    }),
    null,
  );
});

test("selectRestartRecommendation still flags non-quiet no-active classifications as restart-not-enough", () => {
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#188 classification=repair_already_queued state=repairing_ci reason=repairable_path_hygiene_retry_state",
      ],
    })).category,
    "restart_not_enough",
  );
});

test("selectRestartRecommendation preserves the matching source for safe restart recovery lines", () => {
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_recovery action=inspect_then_restart owner=supervisor recommendation=restart_loop",
      ],
    })).source,
    "loop_runtime_recovery",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "doctor_loop_runtime_recovery action=inspect_then_restart owner=supervisor recommendation=restart_loop",
      ],
    })).source,
    "doctor_loop_runtime_recovery",
  );
  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "doctor_loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
      ],
    })).source,
    "doctor_loop_runtime_diagnostic",
  );
});

test("selectRestartRecommendation does not let safe restart outrank manual review before restart", () => {
  const recommendation = requireRestartRecommendation(selectRestartRecommendation({
    detailedStatusLines: [
      "loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
      "no_active_tracked_record issue=#188 classification=manual_review_required state=blocked reason=manual_review",
    ],
  }));

  assert.equal(recommendation.category, "manual_review_before_restart");
  assert.equal(recommendation.source, "no_active_tracked_record");

  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "loop_runtime_diagnostic kind=duplicate_loop_processes status=duplicate matching_processes=2 pids=4242,4243 config_path=<supervisor-config-path> state_file=<state-file> recovery=inspect_then_restart",
        "no_active_tracked_record issue=#188 classification=provider_outage_suspected state=blocked reason=review_provider_wait",
      ],
    })).category,
    "manual_review_before_restart",
  );
});

test("selectRestartRecommendation prioritizes manual review for stopped clustered Codex churn", () => {
  const recommendation = requireRestartRecommendation(selectRestartRecommendation({
    detailedStatusLines: [
      "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=blocked first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config",
      "codex_connector_review_churn_progress classification=unchanged current_head_sha=head-current-188 previous_head_sha=head-previous-188 current_effective_must_fix=8 previous_effective_must_fix=8 effective_must_fix_delta=0 dominant_file=src/release-readiness.ts dominant_file_percent=100 cluster_category_signature=truth_source representative_threads=thread-authority,thread-truth",
      "no_active_tracked_record issue=#188 classification=manual_review_required state=blocked reason=manual_review",
    ],
  }));

  assert.equal(recommendation.category, "manual_review_before_restart");
  assert.equal(recommendation.source, "codex_connector_review_churn_progress");
  assert.match(recommendation.summary, /current effective must-fix count 8/);
  assert.match(recommendation.summary, /src\/release-readiness\.ts/);
});

test("selectStatusOperatorAction prioritizes manual review for stopped clustered Codex churn", () => {
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "loop_runtime_blocker state=off active_tracked_issues=1 first_issue=#188 first_state=blocked first_pr=#288 action=restart_loop restart_reason=recoverable_active_tracked_work_waiting_for_loop expected_outcome=loop_runtime_state_running_then_tracked_issue_advances fallback=if_blocker_remains_run_status_why_and_doctor_then_inspect_runtime_marker_and_config",
        "codex_connector_review_churn_progress classification=unchanged current_head_sha=head-current-188 previous_head_sha=head-previous-188 current_effective_must_fix=8 previous_effective_must_fix=8 effective_must_fix_delta=0 dominant_file=src/release-readiness.ts dominant_file_percent=100 cluster_category_signature=truth_source representative_threads=thread-authority,thread-truth",
      ],
    }),
    {
      action: "manual_review",
      source: "codex_connector_review_churn_progress",
      priority: 95,
      summary:
        "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 8 before restarting the loop.",
    },
  );
});

test("clustered Codex churn progress does not force manual review without a stopped gate", () => {
  const activeChurnProgress =
    "codex_connector_review_churn_progress classification=unchanged current_head_sha=head-current-188 previous_head_sha=head-previous-188 current_effective_must_fix=8 previous_effective_must_fix=8 effective_must_fix_delta=0 dominant_file=src/release-readiness.ts dominant_file_percent=100 cluster_category_signature=truth_source representative_threads=thread-authority,thread-truth";

  assert.equal(
    selectRestartRecommendation({
      detailedStatusLines: [
        "issue=#188",
        "state=addressing_review",
        "loop_runtime state=running host_mode=tmux run_mode=supervisor marker_path=<loop-marker> config_path=<supervisor-config-path> state_file=<state-file> pid=4242 started_at=2026-06-01T06:20:00Z ownership_confidence=live_lock detail=running",
        activeChurnProgress,
      ],
    }),
    null,
  );
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "issue=#188",
        "state=addressing_review",
        "loop_runtime state=running host_mode=tmux run_mode=supervisor marker_path=<loop-marker> config_path=<supervisor-config-path> state_file=<state-file> pid=4242 started_at=2026-06-01T06:20:00Z ownership_confidence=live_lock detail=running",
        activeChurnProgress,
      ],
    }),
    {
      action: "continue",
      source: "status",
      priority: 0,
      summary: "No blocking operator action was detected; continue normal supervisor operation.",
    },
  );
});

test("selectStatusOperatorAction accepts no-active manual review as a clustered churn stop gate", () => {
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: [
        "codex_connector_review_churn_progress classification=worse current_head_sha=head-current-188 previous_head_sha=head-previous-188 current_effective_must_fix=9 previous_effective_must_fix=8 effective_must_fix_delta=1 dominant_file=src/release-readiness.ts dominant_file_percent=100 cluster_category_signature=truth_source representative_threads=thread-authority,thread-truth",
        "no_active_tracked_record issue=#188 classification=manual_review_required state=blocked reason=manual_review",
      ],
    }),
    {
      action: "manual_review",
      source: "codex_connector_review_churn_progress",
      priority: 95,
      summary:
        "Clustered Codex Connector churn made no progress; inspect dominant file src/release-readiness.ts with current effective must-fix count 9 before restarting the loop.",
    },
  );
});

test("selectRestartRecommendation suppresses stale manual-review restart advice for selected request-eligible Codex recovery", () => {
  assert.equal(
    selectRestartRecommendation({
      detailedStatusLines: [
        "codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=head-1 current_head_observed_at=none required_checks_green_at=2026-05-19T09:03:41Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=2026-05-19T09:13:41.000Z",
        "no_active_tracked_record issue=#169 classification=manual_review_required state=blocked reason=manual_review",
      ],
      contextLines: ["selected_issue=#169"],
    }),
    null,
  );

  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: [
        "no_active_tracked_record issue=#169 classification=manual_review_required state=blocked reason=manual_review",
      ],
      contextLines: ["selected_issue=#169"],
    })).category,
    "manual_review_before_restart",
  );
});

test("clustered Codex churn does not suppress selected request-eligible Codex recovery", () => {
  const lines = [
    "codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=head-1 current_head_observed_at=none required_checks_green_at=2026-05-19T09:03:41Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=2026-05-19T09:13:41.000Z",
    "codex_connector_review_churn_progress classification=unchanged current_head_sha=head-1 previous_head_sha=head-0 current_effective_must_fix=8 previous_effective_must_fix=8 effective_must_fix_delta=0 dominant_file=src/release-readiness.ts dominant_file_percent=100 cluster_category_signature=truth_source representative_threads=thread-authority,thread-truth",
    "no_active_tracked_record issue=#169 classification=manual_review_required state=blocked reason=manual_review",
  ];

  assert.equal(
    selectRestartRecommendation({
      detailedStatusLines: lines,
      contextLines: ["selected_issue=#169"],
    }),
    null,
  );
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: lines,
      contextLines: ["selected_issue=#169"],
    }),
    {
      action: "provider_outage_suspected",
      source: "codex_connector_review_fallback",
      priority: 70,
      summary:
        "A current-head Codex Connector review request is eligible; run the selected supervisor cycle to post or record it.",
    },
  );
});

test("unanchored clustered Codex churn does not override selected request-eligible recovery", () => {
  const lines = [
    "codex_connector_review_fallback status=request_eligible provider=codex current_head_sha=head-1 current_head_observed_at=none required_checks_green_at=2026-05-19T09:03:41Z timeout_action=request_review_comment requested_at=none requested_head_sha=none review_signal=missing note=request_comment_is_not_review_completion next_action=request_current_head_review wait_until=2026-05-19T09:13:41.000Z",
    "codex_connector_review_churn_progress classification=unchanged current_head_sha=head-1 previous_head_sha=head-0 current_effective_must_fix=8 previous_effective_must_fix=8 effective_must_fix_delta=0 dominant_file=src/release-readiness.ts dominant_file_percent=100 cluster_category_signature=truth_source representative_threads=thread-authority,thread-truth",
    "no_active_tracked_record issue=#170 classification=manual_review_required state=blocked reason=manual_review",
  ];

  assert.equal(
    requireRestartRecommendation(selectRestartRecommendation({
      detailedStatusLines: lines,
      contextLines: ["selected_issue=#169"],
    })).source,
    "no_active_tracked_record",
  );
  assert.deepEqual(
    selectStatusOperatorAction({
      detailedStatusLines: lines,
      contextLines: ["selected_issue=#169"],
    }),
    {
      action: "provider_outage_suspected",
      source: "codex_connector_review_fallback",
      priority: 70,
      summary:
        "A current-head Codex Connector review request is eligible; run the selected supervisor cycle to post or record it.",
    },
  );
});
