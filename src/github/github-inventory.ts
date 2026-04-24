import fs from "node:fs/promises";
import path from "node:path";
import {
  CandidateDiscoveryDiagnostics,
  InventoryRefreshDiagnosticEntry,
  GitHubRateLimitBudget,
  GitHubRateLimitTelemetry,
  SupervisorConfig,
} from "../core/types";
import type { GitHubIssue } from "./types";
import { DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW } from "../core/config";
import { CommandResult } from "../core/command";
import { isGitHubRateLimitFailure } from "./github-transport";
import { ensureDir, parseJson, truncatePreservingStartAndEnd, writeFileAtomic, writeJsonAtomic } from "../core/utils";

const FULL_ISSUE_INVENTORY_PAGE_SIZE = 100;
const MALFORMED_INVENTORY_CAPTURE_LIMIT_ENV = "CODEX_SUPERVISOR_MALFORMED_INVENTORY_CAPTURE_LIMIT";
const DEFAULT_MALFORMED_INVENTORY_CAPTURE_LIMIT = 10;
const INVENTORY_FAILURE_OUTPUT_LIMIT = 2_000;

interface InventoryCaptureArtifact {
  transport: "primary" | "fallback";
  source: string;
  message: string;
  page: number | null;
  rawArtifactPath: string;
  previewArtifactPath: string;
  command: string[];
  parseStage: "primary_json_parse" | "fallback_json_parse";
  parseError: string;
  stdoutBytes: number;
  stderrBytes: number;
  capturedAt: string;
  workingDirectory: string;
}

export interface ListAllIssuesOptions {
  captureDir?: string | null;
}

interface GitHubRestIssue {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  state: string;
  labels?: Array<{ name: string }>;
  pull_request?: unknown;
}

interface GitHubSearchIssuesResponse {
  items: GitHubRestIssue[];
}

interface GitHubRateLimitResourcePayload {
  limit: number;
  remaining: number;
  reset: number;
  resource: string;
}

interface GitHubRateLimitResponse {
  resources?: {
    core?: GitHubRateLimitResourcePayload;
    graphql?: GitHubRateLimitResourcePayload;
  };
}

function looksLikeJsonArrayPayload(raw: string): boolean {
  return raw.trimStart().startsWith("[");
}

function inventoryCaptureTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, (match) => match);
}

function inventoryCaptureSourceSlug(source: string, page?: number): string {
  if (source === "gh issue list") {
    return "gh-issue-list";
  }

  if (page !== undefined) {
    return `rest-page-${page}`;
  }

  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inventoryCaptureBaseName(source: string, capturedAt: string, page?: number): string {
  return `${inventoryCaptureTimestamp(capturedAt)}-${inventoryCaptureSourceSlug(source, page)}`;
}

function inventoryCaptureLimit(): number {
  const raw = process.env[MALFORMED_INVENTORY_CAPTURE_LIMIT_ENV];
  if (!raw) {
    return DEFAULT_MALFORMED_INVENTORY_CAPTURE_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MALFORMED_INVENTORY_CAPTURE_LIMIT;
}

function renderInventoryFailureOutput(result: CommandResult): string | null {
  return truncatePreservingStartAndEnd(
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n"),
    INVENTORY_FAILURE_OUTPUT_LIMIT,
  );
}

export class GitHubInventoryRefreshError extends Error {
  readonly diagnostics: InventoryRefreshDiagnosticEntry[];

  constructor(message: string, diagnostics: InventoryRefreshDiagnosticEntry[], options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GitHubInventoryRefreshError";
    this.diagnostics = diagnostics.map((entry) => ({
      ...entry,
      ...(entry.command ? { command: [...entry.command] } : {}),
    }));
  }
}

export class GitHubInventoryClient {
  constructor(
    private readonly config: SupervisorConfig,
    private readonly runGhCommand: (args: string[]) => Promise<CommandResult>,
    private readonly now: () => number = Date.now,
  ) {}

  async getRateLimitTelemetry(): Promise<GitHubRateLimitTelemetry> {
    const result = await this.runGhCommand(["api", "rate_limit"]);
    const payload = parseJson<GitHubRateLimitResponse>(result.stdout, "gh api rate_limit");

    return {
      rest: this.mapRateLimitBudget(payload.resources?.core, "core"),
      graphql: this.mapRateLimitBudget(payload.resources?.graphql, "graphql"),
    };
  }

  async listAllIssues(options: ListAllIssuesOptions = {}): Promise<GitHubIssue[]> {
    const command = [
      "issue",
      "list",
      "--repo",
      this.config.repoSlug,
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,body,createdAt,updatedAt,url,labels,state",
    ];
    const result = await this.runGhCommand(command);
    try {
      return parseJson<GitHubIssue[]>(result.stdout, "gh issue list");
    } catch (error) {
      const primaryCapture = await this.captureMalformedInventoryPayload({
        transport: "primary",
        source: "gh issue list",
        captureDir: options.captureDir,
        args: command,
        result,
        parseStage: "primary_json_parse",
        parseError: error,
      });
      const primaryDiagnostic = this.buildInventoryRefreshDiagnostic({
        transport: "primary",
        source: "gh issue list",
        message: error instanceof Error ? error.message : String(error),
        capture: primaryCapture,
      });
      const primaryFailureMessage = [
        primaryDiagnostic.message,
        renderInventoryFailureOutput(result),
        primaryCapture ? `Malformed inventory raw payload: ${primaryCapture.rawArtifactPath}` : null,
        primaryCapture ? `Malformed inventory preview: ${primaryCapture.previewArtifactPath}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      if (isGitHubRateLimitFailure(primaryFailureMessage) || !looksLikeJsonArrayPayload(result.stdout)) {
        throw new GitHubInventoryRefreshError(primaryFailureMessage, [primaryDiagnostic], { cause: error });
      }
      return this.listAllIssuesViaRestApi(primaryDiagnostic, options);
    }
  }

  async listCandidateIssues(): Promise<GitHubIssue[]> {
    return this.fetchAllCandidateIssues();
  }

  async getCandidateDiscoveryDiagnostics(): Promise<CandidateDiscoveryDiagnostics> {
    const fetchWindow = this.candidateDiscoveryPageSize();
    const issues = await this.fetchAllCandidateIssues();
    return {
      fetchWindow,
      observedMatchingOpenIssues: issues.length,
      truncated: false,
    };
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const result = await this.runGhCommand([
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      this.config.repoSlug,
      "--json",
      "number,title,body,createdAt,updatedAt,url,labels,state",
    ]);
    return parseJson<GitHubIssue>(result.stdout, `gh issue view #${issueNumber}`);
  }

  private repoOwnerAndName(): { owner: string; repo: string } {
    const [owner, repo] = this.config.repoSlug.split("/", 2);
    if (!owner || !repo) {
      throw new Error(`Invalid repoSlug: ${this.config.repoSlug}`);
    }

    return { owner, repo };
  }

  private classifyRateLimitBudget(limit: number, remaining: number): GitHubRateLimitBudget["state"] {
    if (remaining <= 0) {
      return "exhausted";
    }

    return remaining / Math.max(limit, 1) <= 0.1 ? "low" : "healthy";
  }

  private mapRateLimitBudget(
    resource: GitHubRateLimitResourcePayload | undefined,
    fallbackResource: "core" | "graphql",
  ): GitHubRateLimitBudget {
    if (!resource) {
      throw new Error(`GitHub rate_limit response omitted ${fallbackResource} budget data.`);
    }

    return {
      resource: resource.resource || fallbackResource,
      limit: resource.limit,
      remaining: resource.remaining,
      resetAt: new Date(resource.reset * 1000).toISOString(),
      state: this.classifyRateLimitBudget(resource.limit, resource.remaining),
    };
  }

  private candidateDiscoveryPageSize(): number {
    return this.config.candidateDiscoveryFetchWindow ?? DEFAULT_CANDIDATE_DISCOVERY_FETCH_WINDOW;
  }

  private mapRestIssue(issue: GitHubRestIssue): GitHubIssue | null {
    if (issue.pull_request) {
      return null;
    }

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      url: issue.html_url,
      labels: issue.labels?.map((label) => ({ name: label.name })),
      state: issue.state.toUpperCase(),
    };
  }

  private sortCandidateIssues(issues: GitHubIssue[]): GitHubIssue[] {
    return [...issues].sort((left, right) => {
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      if (createdAtOrder !== 0) {
        return createdAtOrder;
      }

      return left.number - right.number;
    });
  }

  private async listRepositoryCandidateIssuePage(page: number, perPage: number): Promise<GitHubIssue[]> {
    const { owner, repo } = this.repoOwnerAndName();
    const args = [
      "api",
      `repos/${owner}/${repo}/issues`,
      "--method",
      "GET",
      "-f",
      "state=open",
      "-f",
      `per_page=${perPage}`,
      "-f",
      `page=${page}`,
    ];

    if (this.config.issueLabel) {
      args.push("-f", `labels=${this.config.issueLabel}`);
    }

    const result = await this.runGhCommand(args);
    const issues = parseJson<GitHubRestIssue[]>(result.stdout, `gh api repos/${owner}/${repo}/issues page=${page}`);
    return issues
      .map((issue) => this.mapRestIssue(issue))
      .filter((issue): issue is GitHubIssue => issue !== null);
  }

  private async listAllIssuesViaRestApi(
    primaryDiagnostic: InventoryRefreshDiagnosticEntry,
    options: ListAllIssuesOptions,
  ): Promise<GitHubIssue[]> {
    try {
      const { owner, repo } = this.repoOwnerAndName();
      const issues: GitHubIssue[] = [];

      for (let page = 1; ; page += 1) {
        const args = [
          "api",
          `repos/${owner}/${repo}/issues`,
          "--method",
          "GET",
          "-f",
          "state=all",
          "-f",
          `per_page=${FULL_ISSUE_INVENTORY_PAGE_SIZE}`,
          "-f",
          `page=${page}`,
        ];
        const result = await this.runGhCommand(args);
        let pageResponse: GitHubRestIssue[];
        try {
          pageResponse = parseJson<GitHubRestIssue[]>(
            result.stdout,
            `gh api repos/${owner}/${repo}/issues page=${page}`,
          );
        } catch (parseError) {
          const fallbackCapture = await this.captureMalformedInventoryPayload({
            transport: "fallback",
            source: `gh api repos/${owner}/${repo}/issues`,
            page,
            captureDir: options.captureDir,
            args,
            result,
            parseStage: "fallback_json_parse",
            parseError,
          });
          const fallbackDiagnostic = this.buildInventoryRefreshDiagnostic({
            transport: "fallback",
            source: `gh api repos/${owner}/${repo}/issues`,
            message: parseError instanceof Error ? parseError.message : String(parseError),
            page,
            capture: fallbackCapture,
          });
          const fallbackMessage = [
            fallbackDiagnostic.message,
            fallbackCapture ? `Malformed inventory raw payload: ${fallbackCapture.rawArtifactPath}` : null,
            fallbackCapture ? `Malformed inventory preview: ${fallbackCapture.previewArtifactPath}` : null,
          ]
            .filter(Boolean)
            .join("\n");
          throw new GitHubInventoryRefreshError(
            [
              "Failed to load full issue inventory.",
              `Primary transport: ${primaryDiagnostic.message}`,
              primaryDiagnostic.raw_artifact_path
                ? `Malformed inventory raw payload: ${primaryDiagnostic.raw_artifact_path}`
                : null,
              primaryDiagnostic.preview_artifact_path
                ? `Malformed inventory preview: ${primaryDiagnostic.preview_artifact_path}`
                : primaryDiagnostic.artifact_path
                  ? `Malformed inventory preview: ${primaryDiagnostic.artifact_path}`
                  : null,
              `Fallback transport: ${fallbackMessage}`,
            ].filter(Boolean).join("\n"),
            [primaryDiagnostic, fallbackDiagnostic],
            { cause: parseError },
          );
        }
        const pageIssues = pageResponse
          .map((issue) => this.mapRestIssue(issue))
          .filter((issue): issue is GitHubIssue => issue !== null);

        issues.push(...pageIssues);
        if (pageResponse.length < FULL_ISSUE_INVENTORY_PAGE_SIZE) {
          break;
        }
      }

      return issues;
    } catch (fallbackError) {
      if (fallbackError instanceof GitHubInventoryRefreshError) {
        throw fallbackError;
      }
      const { owner, repo } = this.repoOwnerAndName();
      const fallbackDiagnostic = this.buildInventoryRefreshDiagnostic({
        transport: "fallback",
        source: `gh api repos/${owner}/${repo}/issues`,
        message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      throw new GitHubInventoryRefreshError(
        [
          "Failed to load full issue inventory.",
          `Primary transport: ${primaryDiagnostic.message}`,
          primaryDiagnostic.raw_artifact_path
            ? `Malformed inventory raw payload: ${primaryDiagnostic.raw_artifact_path}`
            : null,
          primaryDiagnostic.preview_artifact_path
            ? `Malformed inventory preview: ${primaryDiagnostic.preview_artifact_path}`
            : primaryDiagnostic.artifact_path
              ? `Malformed inventory preview: ${primaryDiagnostic.artifact_path}`
              : null,
          `Fallback transport: ${fallbackDiagnostic.message}`,
        ].join("\n"),
        [primaryDiagnostic, fallbackDiagnostic],
        { cause: fallbackError },
      );
    }
  }

  private async captureMalformedInventoryPayload(args: {
    transport: "primary" | "fallback";
    source: string;
    captureDir?: string | null;
    args: string[];
    result: CommandResult;
    parseStage: "primary_json_parse" | "fallback_json_parse";
    parseError: unknown;
    page?: number;
  }): Promise<InventoryCaptureArtifact | null> {
    const captureDir = args.captureDir?.trim();
    if (!captureDir) {
      return null;
    }

    const capturedAt = new Date(this.now()).toISOString();
    const baseName = inventoryCaptureBaseName(args.source, capturedAt, args.page);
    const rawArtifactPath = path.join(captureDir, `${baseName}-raw.json`);
    const previewArtifactPath = path.join(captureDir, `${baseName}-preview.json`);
    const parseMessage = args.parseError instanceof Error ? args.parseError.message : String(args.parseError);
    const workingDirectory = process.cwd();
    const stdoutBytes = Buffer.byteLength(args.result.stdout, "utf8");
    const stderrBytes = Buffer.byteLength(args.result.stderr, "utf8");
    await ensureDir(captureDir);
    await writeFileAtomic(rawArtifactPath, args.result.stdout);
    try {
      await writeJsonAtomic(previewArtifactPath, {
        capturedAt,
        transport: args.transport,
        source: args.source,
        page: args.page ?? null,
        parseStage: args.parseStage,
        rawArtifactPath,
        previewArtifactPath,
        command: ["gh", ...args.args],
        parseError: parseMessage,
        stdoutPreview: truncatePreservingStartAndEnd(args.result.stdout, INVENTORY_FAILURE_OUTPUT_LIMIT) ?? "",
        stderrPreview: truncatePreservingStartAndEnd(args.result.stderr, INVENTORY_FAILURE_OUTPUT_LIMIT) ?? "",
        stdoutBytes,
        stderrBytes,
        context: {
          repoSlug: this.config.repoSlug,
          workingDirectory,
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version,
          ghHost: process.env.GH_HOST ?? null,
          ghRepo: process.env.GH_REPO ?? null,
          ghConfigDir: process.env.GH_CONFIG_DIR ?? null,
        },
      });
    } catch (error) {
      await fs.rm(rawArtifactPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await this.pruneMalformedInventoryCaptures(captureDir);
    return {
      transport: args.transport,
      source: args.source,
      message: parseMessage,
      page: args.page ?? null,
      rawArtifactPath,
      previewArtifactPath,
      command: ["gh", ...args.args],
      parseStage: args.parseStage,
      parseError: parseMessage,
      stdoutBytes,
      stderrBytes,
      capturedAt,
      workingDirectory,
    };
  }

  private buildInventoryRefreshDiagnostic(args: {
    transport: "primary" | "fallback";
    source: string;
    message: string;
    page?: number;
    capture?: InventoryCaptureArtifact | null;
  }): InventoryRefreshDiagnosticEntry {
    const { capture } = args;
    return {
      transport: args.transport,
      source: args.source,
      message: args.message,
      ...(args.page !== undefined ? { page: args.page } : {}),
      ...(capture
        ? {
          raw_artifact_path: capture.rawArtifactPath,
          preview_artifact_path: capture.previewArtifactPath,
          command: capture.command,
          parse_stage: capture.parseStage,
          parse_error: capture.parseError,
          stdout_bytes: capture.stdoutBytes,
          stderr_bytes: capture.stderrBytes,
          captured_at: capture.capturedAt,
          working_directory: capture.workingDirectory,
        }
        : {}),
    };
  }

  private async pruneMalformedInventoryCaptures(captureDir: string): Promise<void> {
    const entries = await fs.readdir(captureDir, { withFileTypes: true });
    const captureEventPattern = /^(\d{8}T\d{6}\.\d{3}Z-.*?)(?:-(?:raw|preview))?\.json$/u;
    const captureEvents = Array.from(new Set(
      entries
        .flatMap((entry) => {
          if (!entry.isFile()) {
            return [];
          }

          const match = entry.name.match(captureEventPattern);
          return match?.[1] ? [match[1]] : [];
        }),
    ))
      .sort();
    const extraEvents = captureEvents.length - inventoryCaptureLimit();
    if (extraEvents <= 0) {
      return;
    }

    await Promise.all(
      captureEvents.slice(0, extraEvents).flatMap((baseName) => ([
        fs.rm(path.join(captureDir, `${baseName}.json`), { force: true }),
        fs.rm(path.join(captureDir, `${baseName}-raw.json`), { force: true }),
        fs.rm(path.join(captureDir, `${baseName}-preview.json`), { force: true }),
      ])),
    );
  }

  private buildCandidateSearchQuery(): string {
    const qualifiers = [`repo:${this.config.repoSlug}`, "is:issue", "is:open"];
    if (this.config.issueLabel) {
      qualifiers.push(`label:"${this.config.issueLabel.replace(/["\\]/g, "\\$&")}"`);
    }

    if (this.config.issueSearch && this.config.issueSearch.trim() !== "") {
      qualifiers.push(this.config.issueSearch.trim());
    }

    return qualifiers.join(" ");
  }

  private async listSearchCandidateIssuePage(page: number, perPage: number): Promise<GitHubIssue[]> {
    const args = [
      "api",
      "search/issues",
      "--method",
      "GET",
      "-f",
      `q=${this.buildCandidateSearchQuery()}`,
      "-f",
      `per_page=${perPage}`,
      "-f",
      `page=${page}`,
    ];
    const result = await this.runGhCommand(args);
    const response = parseJson<GitHubSearchIssuesResponse>(result.stdout, `gh api search/issues page=${page}`);
    return response.items
      .map((issue) => this.mapRestIssue(issue))
      .filter((issue): issue is GitHubIssue => issue !== null);
  }

  private async fetchAllCandidateIssues(): Promise<GitHubIssue[]> {
    const perPage = this.candidateDiscoveryPageSize();
    const issues: GitHubIssue[] = [];

    for (let page = 1; ; page += 1) {
      const pageIssues =
        this.config.issueSearch && this.config.issueSearch.trim() !== ""
          ? await this.listSearchCandidateIssuePage(page, perPage)
          : await this.listRepositoryCandidateIssuePage(page, perPage);
      issues.push(...pageIssues);
      if (pageIssues.length < perPage) {
        break;
      }
    }

    return this.sortCandidateIssues(issues);
  }
}
