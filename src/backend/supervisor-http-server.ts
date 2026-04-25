import http from "node:http";
import { URL } from "node:url";
import {
  unavailableManagedRestartCapability,
  type ManagedRestartCapability,
  type ManagedRestartController,
} from "../managed-restart";
import type { SetupConfigPreviewSelectableReviewProviderProfile } from "../setup-config-preview";
import {
  SetupConfigWriteError,
  type DangerousSetupConfigFieldKey,
  type SetupConfigUpdateResult,
} from "../setup-config-write";
import type { SetupReadinessReport } from "../setup-readiness";
import type { SupervisorLoopController } from "../supervisor/supervisor-loop-controller";
import type { SupervisorEvent, SupervisorService } from "../supervisor";
import { renderSupervisorDashboardHtml } from "./webui-dashboard";
import { renderSupervisorSetupHtml } from "./webui-setup";
import { WEBUI_MUTATION_AUTH_HEADER, type WebUiMutationAuthOptions } from "./webui-mutation-auth";

export interface CreateSupervisorHttpServerOptions {
  service: SupervisorService;
  loopController?: Pick<SupervisorLoopController, "runCycle">;
  managedRestart?: ManagedRestartController | null;
  mutationAuth?: WebUiMutationAuthOptions | null;
  heartbeatIntervalMs?: number;
  replayBufferSize?: number;
}

interface JsonErrorBody {
  error: string;
  code?: string;
  dangerousFields?: string[];
}

class HttpRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details: Omit<JsonErrorBody, "error"> = {},
  ) {
    super(message);
  }
}

interface RunOnceCommandResultDto {
  command: "run-once";
  dryRun: boolean;
  summary: string;
}

export interface SetupReadinessResponseDto extends SetupReadinessReport {
  managedRestart: ManagedRestartCapability;
}

export interface SetupConfigUpdateResponseDto extends SetupConfigUpdateResult {
  managedRestart: ManagedRestartCapability;
}

interface BufferedSupervisorEvent {
  id: number;
  event: SupervisorEvent;
}

interface SseClientConnection {
  response: http.ServerResponse;
  heartbeat: NodeJS.Timeout;
}

const MAX_JSON_BODY_BYTES = 256 * 1024;

export function createSupervisorHttpServer(options: CreateSupervisorHttpServerOptions): http.Server {
  const events = new SupervisorSseEventStream(options.service, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
    replayBufferSize: options.replayBufferSize ?? 32,
  });
  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(
        request,
        response,
        options.service,
        options.loopController,
        events,
        options.managedRestart ?? null,
        options.mutationAuth ?? null,
      );
    } catch (error) {
      if (error instanceof HttpRequestError) {
        writeJson(response, error.statusCode, { error: error.message, ...error.details });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 500, { error: message });
    }
  });
  server.on("close", () => {
    events.close();
  });
  return server;
}

async function readDashboardSetupReadiness(
  service: Pick<SupervisorService, "querySetupReadiness">,
): Promise<Awaited<ReturnType<NonNullable<SupervisorService["querySetupReadiness"]>>> | null> {
  if (!service.querySetupReadiness) {
    return null;
  }
  try {
    return await service.querySetupReadiness();
  } catch {
    return null;
  }
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  service: SupervisorService,
  loopController: Pick<SupervisorLoopController, "runCycle"> | undefined,
  events: SupervisorSseEventStream,
  managedRestart: ManagedRestartController | null,
  mutationAuth: WebUiMutationAuthOptions | null,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname.startsWith("/api/commands/")) {
    if (method !== "POST") {
      response.setHeader("Allow", "POST");
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }

    authorizeMutationRequest(request, mutationAuth);
    await handleCommandRequest(request, response, pathname, service, loopController, managedRestart);
    return;
  }

  if (pathname === "/api/setup-config") {
    if (method !== "POST") {
      response.setHeader("Allow", "POST");
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    authorizeMutationRequest(request, mutationAuth);
    if (!service.updateSetupConfig) {
      writeJson(response, 404, { error: "Not found." });
      return;
    }
    const body = await readJsonBody(request);
    const { changes, dangerousOptInConfirmation } = readSetupConfigWriteRequest(body);
    try {
      const updateOptions =
        dangerousOptInConfirmation === undefined
          ? { changes }
          : { changes, dangerousOptInConfirmation };
      writeJson(
        response,
        200,
        withManagedRestartCapability(await service.updateSetupConfig(updateOptions), managedRestart),
      );
    } catch (error) {
      if (error instanceof SetupConfigWriteError) {
        throw new HttpRequestError(400, error.message, {
          code: error.code,
          dangerousFields: error.dangerousFields,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpRequestError(400, message);
    }
    return;
  }

  if (method !== "GET") {
    response.setHeader("Allow", "GET");
    writeJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    const setupReadiness = await readDashboardSetupReadiness(service);
    writeHtml(
      response,
      200,
      setupReadiness && !setupReadiness.ready ? renderSupervisorSetupHtml() : renderSupervisorDashboardHtml(setupReadiness),
    );
    return;
  }

  if (pathname === "/setup") {
    writeHtml(response, 200, renderSupervisorSetupHtml());
    return;
  }

  if (pathname === "/dashboard") {
    const setupReadiness = await readDashboardSetupReadiness(service);
    writeHtml(response, 200, renderSupervisorDashboardHtml(setupReadiness));
    return;
  }

  if (pathname === "/api/status") {
    const why = parseBooleanQueryValue(url.searchParams.get("why"));
    writeJson(response, 200, await service.queryStatus({ why }));
    return;
  }

  if (pathname === "/api/doctor") {
    writeJson(response, 200, await service.queryDoctor());
    return;
  }

  if (pathname === "/api/post-merge-audits/summary") {
    if (!service.queryPostMergeAuditSummary) {
      writeJson(response, 404, { error: "Not found." });
      return;
    }
    writeJson(response, 200, await service.queryPostMergeAuditSummary());
    return;
  }

  if (pathname === "/api/setup-readiness") {
    if (!service.querySetupReadiness) {
      writeJson(response, 404, { error: "Not found." });
      return;
    }
    writeJson(response, 200, withManagedRestartCapability(await service.querySetupReadiness(), managedRestart));
    return;
  }

  if (pathname === "/api/setup-config-preview") {
    if (!service.querySetupConfigPreview) {
      writeJson(response, 404, { error: "Not found." });
      return;
    }
    const reviewProviderProfile = parseReviewProviderProfileQuery(url.searchParams.get("reviewProviderProfile"));
    if (url.searchParams.get("reviewProviderProfile") !== null && reviewProviderProfile === null) {
      writeJson(response, 400, { error: "reviewProviderProfile must be one of none, copilot, codex, or coderabbit." });
      return;
    }
    writeJson(response, 200, await service.querySetupConfigPreview({ reviewProviderProfile: reviewProviderProfile ?? undefined }));
    return;
  }

  if (pathname === "/api/events") {
    const lastEventId = parseLastEventId(request.headers["last-event-id"]);
    if (lastEventId === null && request.headers["last-event-id"] !== undefined) {
      writeJson(response, 400, { error: "Last-Event-ID must be a non-negative integer." });
      return;
    }
    events.connect(response, lastEventId);
    return;
  }

  const explainMatch = pathname.match(/^\/api\/issues\/([1-9]\d*)\/explain$/u);
  if (explainMatch) {
    writeJson(response, 200, await service.queryExplain(Number.parseInt(explainMatch[1], 10)));
    return;
  }

  const issueLintMatch = pathname.match(/^\/api\/issues\/([1-9]\d*)\/issue-lint$/u);
  if (issueLintMatch) {
    writeJson(response, 200, await service.queryIssueLint(Number.parseInt(issueLintMatch[1], 10)));
    return;
  }

  const malformedIssuePath = pathname.match(/^\/api\/issues\/([^/]+)\/(explain|issue-lint)$/u);
  if (malformedIssuePath) {
    writeJson(response, 400, { error: "Issue number must be a positive integer." });
    return;
  }

  writeJson(response, 404, { error: "Not found." });
}

function authorizeMutationRequest(
  request: http.IncomingMessage,
  mutationAuth: WebUiMutationAuthOptions | null,
): void {
  if (!isLocalHostHeader(request.headers.host)) {
    throw new HttpRequestError(403, "Mutation requests must target a localhost host.");
  }
  if (!isAllowedLocalOrigin(request.headers.origin, request.headers.host)) {
    throw new HttpRequestError(403, "Mutation requests must originate from the local WebUI origin.");
  }
  if (!mutationAuth?.token) {
    throw new HttpRequestError(503, "Mutation auth is not configured.");
  }

  const providedToken = readSingleHeaderValue(request.headers[WEBUI_MUTATION_AUTH_HEADER]);
  if (!providedToken || providedToken !== mutationAuth.token) {
    throw new HttpRequestError(401, "Mutation auth required.");
  }
}

function readSingleHeaderValue(value: string | string[] | undefined): string | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (typeof normalized !== "string") {
    return null;
  }
  const trimmed = normalized.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLocalHostHeader(hostHeader: string | string[] | undefined): boolean {
  const value = readSingleHeaderValue(hostHeader);
  if (!value) {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

function isAllowedLocalOrigin(originHeader: string | string[] | undefined, hostHeader: string | string[] | undefined): boolean {
  const origin = readSingleHeaderValue(originHeader);
  if (origin === null) {
    return true;
  }

  const host = readSingleHeaderValue(hostHeader);
  if (!host) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const hostUrl = new URL(`http://${host}`);
    if (originUrl.protocol !== "http:") {
      return false;
    }
    if (!isLoopbackHostname(originUrl.hostname)) {
      return false;
    }
    return normalizePort(originUrl) === normalizePort(hostUrl);
  } catch {
    return false;
  }
}

function normalizePort(url: URL): string {
  if (url.port.length > 0) {
    return url.port;
  }
  return url.protocol === "https:" ? "443" : "80";
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "localhost";
}

async function handleCommandRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  pathname: string,
  service: SupervisorService,
  loopController: Pick<SupervisorLoopController, "runCycle"> | undefined,
  managedRestart: ManagedRestartController | null,
): Promise<void> {
  if (pathname === "/api/commands/run-once") {
    if (!loopController) {
      throw new Error("Missing supervisor loop controller for WebUI run-once command.");
    }
    const body = await readJsonBody(request);
    const dryRun = body && typeof body === "object" && "dryRun" in body ? body.dryRun === true : false;
    const result: RunOnceCommandResultDto = {
      command: "run-once",
      dryRun,
      summary: await loopController.runCycle("run-once", { dryRun }),
    };
    writeJson(response, 200, result);
    return;
  }

  if (pathname === "/api/commands/requeue") {
    const body = await readJsonBody(request);
    const issueNumber = readPositiveInteger(body, "issueNumber");
    if (issueNumber === null) {
      writeJson(response, 400, { error: "Issue number must be a positive integer." });
      return;
    }

    writeJson(response, 200, await service.runRecoveryAction("requeue", issueNumber));
    return;
  }

  if (pathname === "/api/commands/prune-orphaned-workspaces") {
    await readJsonBody(request);
    writeJson(response, 200, await service.pruneOrphanedWorkspaces());
    return;
  }

  if (pathname === "/api/commands/reset-corrupt-json-state") {
    await readJsonBody(request);
    writeJson(response, 200, await service.resetCorruptJsonState());
    return;
  }

  if (pathname === "/api/commands/managed-restart") {
    await readJsonBody(request);
    if (!managedRestart?.capability.supported) {
      writeJson(response, 409, { error: unavailableManagedRestartCapability().summary });
      return;
    }
    writeJson(response, 200, await managedRestart.requestRestart());
    return;
  }

  writeJson(response, 404, { error: "Not found." });
}

function withManagedRestartCapability<T extends SetupReadinessReport | SetupConfigUpdateResult>(
  value: T,
  managedRestart: ManagedRestartController | null,
): T & { managedRestart: ManagedRestartCapability } {
  return {
    ...value,
    managedRestart: managedRestart?.capability ?? unavailableManagedRestartCapability(),
  };
}

function parseBooleanQueryValue(value: string | null): boolean {
  return value === "1" || value === "true";
}

function parseReviewProviderProfileQuery(value: string | null): SetupConfigPreviewSelectableReviewProviderProfile | null {
  return value === "none" || value === "copilot" || value === "codex" || value === "coderabbit" ? value : null;
}

function parseLastEventId(value: string | string[] | undefined): number | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized === undefined) {
    return null;
  }
  if (!/^\d+$/u.test(normalized)) {
    return null;
  }
  return Number.parseInt(normalized, 10);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const contentLength = readContentLengthHeader(request.headers["content-length"]);
  if (contentLength !== null && contentLength > MAX_JSON_BODY_BYTES) {
    await drainRequestBody(request);
    throw new HttpRequestError(413, "Request body exceeds the maximum JSON size.");
  }

  let payload = "";
  let payloadBytes = 0;
  let oversized = false;
  request.setEncoding("utf8");
  for await (const chunk of request) {
    if (oversized) {
      continue;
    }
    payloadBytes += Buffer.byteLength(chunk);
    if (payloadBytes > MAX_JSON_BODY_BYTES) {
      oversized = true;
      payload = "";
      continue;
    }
    payload += chunk;
  }

  if (oversized) {
    throw new HttpRequestError(413, "Request body exceeds the maximum JSON size.");
  }

  if (payload.length === 0) {
    return null;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new HttpRequestError(400, "Request body must be valid JSON.");
  }
}

async function drainRequestBody(request: http.IncomingMessage): Promise<void> {
  request.resume();
  for await (const _chunk of request) {
    // Drain the request so the client receives an HTTP error instead of a reset.
  }
}

function readContentLengthHeader(value: string | string[] | undefined): number | null {
  const header = readSingleHeaderValue(value);
  if (!header) {
    return null;
  }

  const contentLength = Number.parseInt(header, 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return null;
  }
  return contentLength;
}

function readPositiveInteger(body: unknown, fieldName: string): number | null {
  if (!body || typeof body !== "object" || !(fieldName in body)) {
    return null;
  }

  const value = body[fieldName as keyof typeof body];
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function readSetupConfigWriteRequest(body: unknown): {
  changes: Record<string, unknown>;
  dangerousOptInConfirmation?: {
    acknowledged: true;
    fieldKeys: DangerousSetupConfigFieldKey[];
  };
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpRequestError(400, "Request body must be a JSON object.");
  }
  if (!("changes" in body)) {
    throw new HttpRequestError(400, "Request body must include a changes object.");
  }

  const changes = (body as { changes: unknown }).changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new HttpRequestError(400, "changes must be an object.");
  }

  const confirmation = (body as { dangerousOptInConfirmation?: unknown }).dangerousOptInConfirmation;
  if (confirmation === undefined) {
    return { changes: changes as Record<string, unknown> };
  }
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) {
    throw new HttpRequestError(400, "dangerousOptInConfirmation must be an object when provided.");
  }
  const rawConfirmation = confirmation as Record<string, unknown>;
  if (rawConfirmation.acknowledged !== true) {
    throw new HttpRequestError(400, "dangerousOptInConfirmation.acknowledged must be true.");
  }
  if (
    !Array.isArray(rawConfirmation.fieldKeys) ||
    rawConfirmation.fieldKeys.some((field) => typeof field !== "string")
  ) {
    throw new HttpRequestError(400, "dangerousOptInConfirmation.fieldKeys must be an array of strings.");
  }

  return {
    changes: changes as Record<string, unknown>,
    dangerousOptInConfirmation: {
      acknowledged: true,
      fieldKeys: rawConfirmation.fieldKeys as DangerousSetupConfigFieldKey[],
    },
  };
}

function writeJson(response: http.ServerResponse, statusCode: number, body: JsonErrorBody | unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}

function writeHtml(response: http.ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

class SupervisorSseEventStream {
  private readonly clients = new Set<SseClientConnection>();
  private readonly eventBuffer: BufferedSupervisorEvent[] = [];
  private readonly unsubscribe: () => void;
  private nextEventId = 1;

  constructor(
    service: SupervisorService,
    private readonly options: { heartbeatIntervalMs: number; replayBufferSize: number },
  ) {
    this.unsubscribe = service.subscribeEvents?.((event) => {
      this.handleEvent(event);
    }) ?? (() => {});
  }

  connect(response: http.ServerResponse, lastEventId: number | null): void {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.socket?.setKeepAlive(true);
    response.socket?.setNoDelay(true);

    if (lastEventId !== null) {
      for (const entry of this.eventBuffer) {
        if (entry.id > lastEventId) {
          response.write(formatSseEvent(entry));
        }
      }
    }

    const connection: SseClientConnection = {
      response,
      heartbeat: setInterval(() => {
        response.write(": heartbeat\n\n");
      }, this.options.heartbeatIntervalMs),
    };

    this.clients.add(connection);

    const cleanup = () => {
      clearInterval(connection.heartbeat);
      this.clients.delete(connection);
    };
    response.on("close", cleanup);
    response.on("error", cleanup);
  }

  close(): void {
    this.unsubscribe();
    for (const client of this.clients) {
      clearInterval(client.heartbeat);
      client.response.destroy();
    }
    this.clients.clear();
  }

  private handleEvent(event: SupervisorEvent): void {
    const entry: BufferedSupervisorEvent = {
      id: this.nextEventId,
      event,
    };
    this.nextEventId += 1;
    this.eventBuffer.push(entry);
    if (this.eventBuffer.length > this.options.replayBufferSize) {
      this.eventBuffer.splice(0, this.eventBuffer.length - this.options.replayBufferSize);
    }

    const payload = formatSseEvent(entry);
    for (const client of [...this.clients]) {
      client.response.write(payload);
    }
  }
}

function formatSseEvent(entry: BufferedSupervisorEvent): string {
  return `id: ${entry.id}\nevent: ${entry.event.type}\ndata: ${JSON.stringify(entry.event)}\n\n`;
}
