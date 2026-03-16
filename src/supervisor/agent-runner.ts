import type { BlockedReason, FailureKind, FailureContext, IssueRunRecord, RunState, SupervisorConfig } from "../core/types";

export interface AgentRunnerCapabilities {
  supportsResume: boolean;
  supportsStructuredResult: boolean;
}

interface AgentRunnerBaseRequest {
  config: SupervisorConfig;
  workspacePath: string;
  prompt: string;
  state: RunState;
  record?: Pick<
    IssueRunRecord,
    "repeated_failure_signature_count" | "blocked_verification_retry_count" | "timeout_retry_count"
  > | null;
}

export interface StartAgentTurnRequest extends AgentRunnerBaseRequest {
  kind: "start";
}

export interface ResumeAgentTurnRequest extends AgentRunnerBaseRequest {
  kind: "resume";
  sessionId: string;
}

export type AgentTurnRequest = StartAgentTurnRequest | ResumeAgentTurnRequest;

export interface AgentTurnStructuredResult {
  summary: string;
  stateHint: RunState | null;
  blockedReason: BlockedReason;
  failureSignature: string | null;
  nextAction: string | null;
  tests: string | null;
}

export interface AgentTurnResult {
  exitCode: number;
  sessionId: string | null;
  supervisorMessage: string;
  stderr: string;
  stdout: string;
  structuredResult: AgentTurnStructuredResult | null;
  failureKind: FailureKind;
  failureContext: FailureContext | null;
}

export interface AgentRunner {
  readonly capabilities: AgentRunnerCapabilities;
  runTurn(request: AgentTurnRequest): Promise<AgentTurnResult>;
}
