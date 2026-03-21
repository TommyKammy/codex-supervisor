import http from "node:http";
import { URL } from "node:url";
import type { SupervisorEvent, SupervisorService } from "../supervisor";
import { renderSupervisorDashboardHtml } from "./webui-dashboard";

export interface CreateSupervisorHttpServerOptions {
  service: SupervisorService;
  heartbeatIntervalMs?: number;
  replayBufferSize?: number;
}

interface JsonErrorBody {
  error: string;
}

interface BufferedSupervisorEvent {
  id: number;
  event: SupervisorEvent;
}

interface SseClientConnection {
  response: http.ServerResponse;
  heartbeat: NodeJS.Timeout;
}

export function createSupervisorHttpServer(options: CreateSupervisorHttpServerOptions): http.Server {
  const events = new SupervisorSseEventStream(options.service, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
    replayBufferSize: options.replayBufferSize ?? 32,
  });
  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, options.service, events);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 500, { error: message });
    }
  });
  server.on("close", () => {
    events.close();
  });
  return server;
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  service: SupervisorService,
  events: SupervisorSseEventStream,
): Promise<void> {
  if ((request.method ?? "GET") !== "GET") {
    response.setHeader("Allow", "GET");
    writeJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "/index.html") {
    writeHtml(response, 200, renderSupervisorDashboardHtml());
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

function parseBooleanQueryValue(value: string | null): boolean {
  return value === "1" || value === "true";
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
