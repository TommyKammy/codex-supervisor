import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { StateStore } from "../core/state-store";
import { GitHubIssue, SupervisorStateFile } from "../core/types";
import { renderSupervisorStatusDto } from "./supervisor-status-report";
import { Supervisor } from "./supervisor";
import {
  branchName,
  createRecord,
  createPullRequest,
  createSupervisorFixture,
  executionReadyBody,
  git,
} from "./supervisor-test-helpers";
import {
  CODEX_CONNECTOR_REVIEW_BOT_LOGIN,
  createCodexConnectorTrackedReviewResidueScenario,
  createTrackedPullRequestStatusScenario,
  createTrackedStatusIssue,
  staleResidueDiagnosticLines,
  writeSupervisorState,
} from "./supervisor-diagnostics-status-scenarios";
import {
  clearCurrentReconciliationPhase,
  writeCurrentReconciliationPhase,
} from "./supervisor-reconciliation-phase";

test("renderSupervisorStatusDto appends canonical github rate-limit lines from dto.githubRateLimit", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    githubRateLimit: {
      rest: {
        resource: "core",
        limit: 5000,
        remaining: 75,
        resetAt: "2026-03-27T00:30:00.000Z",
        state: "low",
      },
      graphql: {
        resource: "graphql",
        limit: 5000,
        remaining: 0,
        resetAt: "2026-03-27T00:15:00.000Z",
        state: "exhausted",
      },
    },
    candidateDiscovery: null,
    loopRuntime: {
      state: "off",
      hostMode: "unknown",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock",
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      pid: null,
      startedAt: null,
      ownershipConfidence: "none",
      detail: null,
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  });

  assert.match(status, /^github_rate_limit resource=rest status=low remaining=75 limit=5000 reset_at=2026-03-27T00:30:00.000Z$/m);
  assert.match(status, /^github_rate_limit resource=graphql status=exhausted remaining=0 limit=5000 reset_at=2026-03-27T00:15:00.000Z$/m);
});

test("renderSupervisorStatusDto maps provider outage diagnostics to an operator action token", () => {
  const status = renderSupervisorStatusDto({
    gsdSummary: null,
    candidateDiscovery: null,
    loopRuntime: {
      state: "running",
      hostMode: "tmux",
      runMode: "macos_tmux_loop",
      markerPath: "/tmp/locks/supervisor/loop-runtime.lock",
      configPath: "/tmp/supervisor.config.json",
      stateFile: "/tmp/state.json",
      pid: 4242,
      startedAt: "2026-03-27T00:15:00.000Z",
      ownershipConfidence: "live_lock",
      detail: "supervisor-loop-runtime",
    },
    activeIssue: null,
    selectionSummary: null,
    trackedIssues: [],
    runnableIssues: [],
    blockedIssues: [],
    detailedStatusLines: [
      "review_bot_diagnostics status=provider_outage_suspected observed_review=none expected_reviewers=coderabbitai next_check=wait_or_provider_setup_or_manual_review recent_observation=required_checks_green:2026-03-16T00:10:00.000Z recoverability=provider_outage_suspected",
    ],
    reconciliationPhase: null,
    reconciliationWarning: null,
    readinessLines: [],
    whyLines: [],
    warning: null,
  });

  assert.match(
    status,
    /^operator_action action=provider_outage_suspected source=review_bot_diagnostics priority=70 summary=The configured review provider has not reported on the current head after checks turned green; wait, verify provider delivery, or escalate to manual review\.$/m,
  );
});
