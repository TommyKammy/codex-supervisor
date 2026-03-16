import { type ExternalReviewMissPattern } from "../external-review-misses";
import { type GitHubIssue, type GitHubPullRequest } from "../types";
import { truncate } from "../utils";
import { renderLines } from "./artifacts";
import { findingKey } from "./finalize";
import { type VerifierGuardrailRule } from "../verifier-guardrails";
import {
  type LocalReviewFinding,
  type LocalReviewVerificationFinding,
  type ParsedRoleFooter,
  type ParsedVerifierFooter,
} from "./types";

interface RolePromptArgs {
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  role: string;
  alwaysReadFiles: string[];
  onDemandFiles: string[];
  confidenceThreshold: number;
  priorMissPatterns: ExternalReviewMissPattern[];
}

function renderPriorMissLines(patterns: ExternalReviewMissPattern[]): string[] {
  if (patterns.length === 0) {
    return [];
  }

  return [
    "Relevant prior confirmed external misses for this diff:",
    "- Use these as targeted checks for blind spots that local review previously missed.",
    ...patterns.map((pattern, index) =>
      [
        `- Prior miss ${index + 1}: file=${pattern.file}:${pattern.line ?? "?"} reviewer=${pattern.reviewerLogin}`,
        `  summary=${pattern.summary}`,
        `  rationale=${pattern.rationale}`,
      ].join("\n"),
    ),
    "",
  ];
}

function renderVerifierGuardrailLines(rules: VerifierGuardrailRule[]): string[] {
  if (rules.length === 0) {
    return [];
  }

  return [
    "Committed verifier guardrails for this diff:",
    "- Treat these as durable verifier cross-checks before dismissing similar findings.",
    ...rules.map((rule, index) =>
      [
        `- Guardrail ${index + 1}: file=${rule.file}:${rule.line ?? "?"} title=${rule.title}`,
        `  summary=${rule.summary}`,
        `  rationale=${rule.rationale}`,
      ].join("\n"),
    ),
    "",
  ];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSeverity(value: unknown): LocalReviewFinding["severity"] | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }

  return null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeFinding(role: string, value: unknown): LocalReviewFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? normalizeWhitespace(record.title) : "";
  const body = typeof record.body === "string" ? normalizeWhitespace(record.body) : "";
  const severity = normalizeSeverity(record.severity);
  const confidence = normalizeConfidence(record.confidence);
  if (!title || !body || !severity || confidence === null) {
    return null;
  }

  let start =
    typeof record.start === "number" && Number.isInteger(record.start) && record.start > 0
      ? record.start
      : null;
  let end =
    typeof record.end === "number" && Number.isInteger(record.end) && record.end > 0
      ? record.end
      : start;

  if (start === null && end !== null) {
    start = end;
  }

  return {
    role,
    title,
    body,
    file: typeof record.file === "string" && record.file.trim() !== "" ? record.file.trim() : null,
    start,
    end,
    severity,
    confidence,
    category: typeof record.category === "string" && record.category.trim() !== "" ? record.category.trim() : null,
    evidence: typeof record.evidence === "string" && record.evidence.trim() !== "" ? truncate(record.evidence.trim(), 500) : null,
  };
}

function normalizeVerificationVerdict(value: unknown): LocalReviewVerificationFinding["verdict"] | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "confirmed" || normalized === "dismissed" || normalized === "unclear") {
    return normalized;
  }

  return null;
}

function normalizeVerificationFinding(value: unknown): LocalReviewVerificationFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const findingKey = typeof record.findingKey === "string" ? normalizeWhitespace(record.findingKey) : "";
  const verdict = normalizeVerificationVerdict(record.verdict);
  const rationale = typeof record.rationale === "string" ? normalizeWhitespace(record.rationale) : "";
  if (!findingKey || !verdict || !rationale) {
    return null;
  }

  return {
    findingKey,
    verdict,
    rationale: truncate(rationale, 500) ?? rationale,
  };
}

export function parseRoleFooter(role: string, output: string): ParsedRoleFooter {
  const summaryMatch = output.match(/Review summary:\s*(.+)/i);
  const recommendationMatch = output.match(/Recommendation:\s*(ready|changes_requested)/i);
  const jsonMatch = output.match(/REVIEW_FINDINGS_JSON_START\s*([\s\S]*?)\s*REVIEW_FINDINGS_JSON_END/i);

  let findings: LocalReviewFinding[] = [];

  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      if (Array.isArray(parsed.findings)) {
        findings = parsed.findings
          .map((item) => normalizeFinding(role, item))
          .filter((item): item is LocalReviewFinding => item !== null);
      }
    } catch {
      findings = [];
    }
  }

  return {
    summary: truncate(summaryMatch?.[1]?.trim() ?? `${role} review completed without a structured summary.`, 500) ?? "",
    recommendation: (recommendationMatch?.[1]?.toLowerCase() as "ready" | "changes_requested" | undefined) ?? "unknown",
    findings,
  };
}

export function parseVerifierFooter(output: string): ParsedVerifierFooter {
  const summaryMatch = output.match(/Verification summary:\s*(.+)/i);
  const recommendationMatch = output.match(/Recommendation:\s*(ready|changes_requested)/i);
  const jsonMatch = output.match(/REVIEW_VERIFIER_JSON_START\s*([\s\S]*?)\s*REVIEW_VERIFIER_JSON_END/i);

  let findings: LocalReviewVerificationFinding[] = [];

  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      if (Array.isArray(parsed.findings)) {
        findings = parsed.findings
          .map((item) => normalizeVerificationFinding(item))
          .filter((item): item is LocalReviewVerificationFinding => item !== null);
      }
    } catch {
      findings = [];
    }
  }

  return {
    summary: truncate(summaryMatch?.[1]?.trim() ?? "Verifier completed without a structured summary.", 500) ?? "",
    recommendation: (recommendationMatch?.[1]?.toLowerCase() as "ready" | "changes_requested" | undefined) ?? "unknown",
    findings,
  };
}

export function compareRef(defaultBranch: string): string {
  return `origin/${defaultBranch}...HEAD`;
}

function roleGoal(role: string): string[] {
  switch (role) {
    case "explorer":
      return [
        "- Start with the diff and identify the narrowest set of risky code paths.",
        "- Focus on missing context, hidden coupling, and files that deserve deeper review.",
        "- Report only actionable engineering findings, not generic suggestions.",
      ];
    case "reviewer":
      return [
        "- Focus on correctness, regressions, edge cases, and missing tests in the changed code paths.",
        "- Prefer the smallest correct implementation when it satisfies the issue.",
        "- Prefer narrowly scoped changes that stay inside the issue scope.",
        "- Flag speculative abstraction, premature generalization, or unnecessary indirection only when it adds concrete maintenance or correctness risk.",
        "- Flag unrelated cleanup, opportunistic refactors, or incidental file churn when they are not required for correctness or tests.",
        "- Do not treat minimal supporting changes as scope drift when they are necessary to make the issue fix correct, testable, or buildable.",
        "- Prefer precise findings tied to a specific file and line whenever possible.",
        "- Anchor findings and promoted guardrails to the decisive behavioral boundary or invariant, not an earlier or merely adjacent implementation location.",
        "- Flag tests or promoted guardrails that hard-code exact source line numbers when a stable behavior, identifier, or nearby intent anchor would verify the same thing.",
        "- Do not object to exact line assertions when source location itself is the intended contract.",
        "- Ignore style nits unless they could hide a bug or maintenance trap.",
      ];
    case "docs_researcher":
      return [
        "- Open durable memory files only if the diff or issue suggests a workflow, architecture, or policy mismatch.",
        "- Focus on requirements drift, contract mismatches, and contradictions with repo guidance.",
        "- Do not report docs-only wording concerns unless they reveal a code or workflow defect.",
      ];
    case "prisma_postgres_reviewer":
      return [
        "- Focus on Prisma schema, migration SQL, PostgreSQL uniqueness semantics, nullability, and relation invariants.",
        "- Look for places where application code assumes a database guarantee that the schema or migration does not actually enforce.",
        "- Prefer findings around unique indexes, partial indexes, check constraints, nullable uniqueness, and schema/migration drift.",
      ];
    case "migration_invariant_reviewer":
      return [
        "- Focus on persisted-state invariants that should be enforced by the database, not just by application validation.",
        "- Look for invalid row combinations, missing CHECK constraints, unsafe defaults, and migrations that allow data shapes the code treats as impossible.",
        "- Report only concrete invariant gaps that could survive into production data.",
      ];
    case "contract_consistency_reviewer":
      return [
        "- Compare API contracts, TypeScript types, schema fields, docs, and tests for drift.",
        "- Look for dropped required fields, widened enums, missing audit fields, and response shapes that no longer match documented behavior.",
        "- Focus on contract mismatches that can break callers or hide data needed for downstream logic.",
      ];
    case "ui_regression_reviewer":
      return [
        "- Focus on UI or browser-flow regressions suggested by the diff, especially around Playwright-covered surfaces.",
        "- Look for changed selectors, state transitions, form flows, and rendering assumptions that could break existing end-to-end tests.",
        "- Report concrete regressions, not general UX suggestions.",
      ];
    case "github_actions_semantics_reviewer":
      return [
        "- Focus on GitHub Actions semantics, event context, concurrency behavior, expression safety, and PR check surface behavior.",
        "- Look for cases where workflow changes can appear green locally but behave differently under pull_request, push, merge queue, or cancelled-run scenarios.",
        "- Prefer findings about incorrect event assumptions, stale cancelled checks, ref collisions, or unsafe workflow expressions.",
      ];
    case "workflow_test_reviewer":
      return [
        "- Focus on tests that validate workflow files or CI behavior.",
        "- Look for brittle regex assertions, newline-sensitive matching, path assumptions, and tests that depend on repo root or exact YAML formatting.",
        "- Prefer findings where a workflow test can pass today but break on harmless formatting changes or different execution environments.",
      ];
    case "portability_reviewer":
      return [
        "- Focus on portability across shells, operating systems, path layouts, and line endings.",
        "- Look for shell-glob assumptions, cwd-sensitive file access, hard-coded separators, and constructs that behave differently on macOS, Linux, or Windows.",
        "- Report only concrete portability risks that could break local development or CI execution.",
      ];
    default:
      return [
        `- Operate as a specialized reviewer named ${role}.`,
        "- Focus on concrete, actionable defects in the current diff.",
        "- Keep context narrow and avoid speculative findings.",
      ];
  }
}

export function buildRolePrompt(args: RolePromptArgs): string {
  const ref = compareRef(args.defaultBranch);
  const priorMissLines = renderPriorMissLines(args.priorMissPatterns);

  return [
    `You are performing a local pre-ready ${args.role} review for ${args.repoSlug}.`,
    `Issue: #${args.issue.number} ${args.issue.title}`,
    `Issue URL: ${args.issue.url}`,
    `PR: #${args.pr.number} ${args.pr.url}`,
    `Branch: ${args.branch}`,
    `Workspace: ${args.workspacePath}`,
    `Compare diff against: ${ref}`,
    "",
    "Goal:",
    ...roleGoal(args.role),
    "",
    "Constraints:",
    "- Do not edit files, do not commit, and do not push.",
    "- Review the current branch only.",
    `- Confidence threshold for actionable findings: ${args.confidenceThreshold.toFixed(2)}.`,
    "- Report only findings that you can justify from the diff and any narrowly targeted reads.",
    "",
    ...(args.alwaysReadFiles.length > 0
      ? [
          "Always-read memory files:",
          ...args.alwaysReadFiles.map((filePath) => `- ${filePath}`),
          "",
          "On-demand durable memory files:",
          ...(args.onDemandFiles.length > 0 ? args.onDemandFiles.map((filePath) => `- ${filePath}`) : ["- none configured"]),
          "",
          "Memory policy:",
          "- Read the always-read files first.",
          "- Use the context index to decide whether any on-demand file is worth opening.",
          "- Do not bulk-read every durable memory file just because multiple reviewer roles exist.",
          "- Keep this role narrow: diff first, then the smallest number of targeted file reads.",
          "",
        ]
      : []),
    ...priorMissLines,
    "Suggested commands:",
    `- git diff --stat ${ref}`,
    `- git diff ${ref}`,
    "",
    "Respond with a concise review and end with this exact footer:",
    "Review summary: <short summary>",
    "Recommendation: <ready|changes_requested>",
    "REVIEW_FINDINGS_JSON_START",
    '{"findings":[{"title":"short label","body":"one-paragraph explanation","file":"path/or/null","start":10,"end":12,"severity":"low|medium|high","confidence":0.0,"category":"optional short tag","evidence":"optional short supporting detail"}]}',
    "REVIEW_FINDINGS_JSON_END",
    "",
    "Return an empty findings array when you have no actionable findings.",
  ].join("\n");
}

export function buildVerifierPrompt(args: {
  repoSlug: string;
  issue: GitHubIssue;
  branch: string;
  workspacePath: string;
  defaultBranch: string;
  pr: GitHubPullRequest;
  findings: LocalReviewFinding[];
  priorMissPatterns: ExternalReviewMissPattern[];
  verifierGuardrails: VerifierGuardrailRule[];
}): string {
  const ref = compareRef(args.defaultBranch);
  const priorMissLines = renderPriorMissLines(args.priorMissPatterns);
  const verifierGuardrailLines = renderVerifierGuardrailLines(args.verifierGuardrails);
  const findingsBlock = args.findings
    .map((finding, index) =>
      [
        `- Finding ${index + 1}`,
        `  key: ${findingKey(finding)}`,
        `  title: ${finding.title}`,
        `  severity: ${finding.severity}`,
        `  file: ${finding.file ?? "none"}`,
        `  lines: ${renderLines(finding)}`,
        `  body: ${finding.body}`,
        ...(finding.evidence ? [`  evidence: ${finding.evidence}`] : []),
      ].join("\n"),
    )
    .join("\n");

  return [
    `You are performing a verifier pass for high-severity local review findings in ${args.repoSlug}.`,
    `Issue: #${args.issue.number} ${args.issue.title}`,
    `Issue URL: ${args.issue.url}`,
    `PR: #${args.pr.number} ${args.pr.url}`,
    `Branch: ${args.branch}`,
    `Workspace: ${args.workspacePath}`,
    `Compare diff against: ${ref}`,
    "",
    "Goal:",
    "- Re-check only the listed high-severity findings.",
    "- Confirm a finding only when the diff and narrowly targeted reads support the original concern.",
    "- When a listed finding is about scope drift, confirm it only when unrelated cleanup or opportunistic refactors fall outside the issue scope and are not required to keep the issue fix correct, testable, or buildable.",
    "- Dismiss findings that appear to be false positives or overstated.",
    "- Do not treat narrow supporting edits as scope drift when they are required to keep the issue fix correct, testable, or buildable.",
    "- Use `unclear` when the evidence is inconclusive from the available local context.",
    "- Prefer the smallest explanation that distinguishes required support work from unrelated churn.",
    "- Treat exact source lines as optional hints unless the finding is explicitly about a user-visible or contractual source location.",
    "- When a test or guardrail could anchor to stable behavior, identifiers, or nearby intent instead of a hard-coded line number, prefer that more stable reading.",
    "- Prefer the real transition or invariant boundary under review over a nearby setup step or incidental code location when deciding whether a finding still holds.",
    "",
    "Constraints:",
    "- Do not edit files, do not commit, and do not push.",
    "- Keep reads narrow and tied to the listed findings.",
    "",
    ...priorMissLines,
    ...verifierGuardrailLines,
    "High-severity findings to verify:",
    findingsBlock,
    "",
    "Respond with a concise verification and end with this exact footer:",
    "Verification summary: <short summary>",
    "Recommendation: <ready|changes_requested>",
    "REVIEW_VERIFIER_JSON_START",
    '{"findings":[{"findingKey":"exact key from prompt","verdict":"confirmed|dismissed|unclear","rationale":"short evidence-based explanation"}]}',
    "REVIEW_VERIFIER_JSON_END",
  ].join("\n");
}
