import http from "node:http";
import { URL } from "node:url";
import type { SupervisorService } from "../supervisor";

export interface CreateSupervisorHttpServerOptions {
  service: SupervisorService;
}

interface JsonErrorBody {
  error: string;
}

export function createSupervisorHttpServer(options: CreateSupervisorHttpServerOptions): http.Server {
  return http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, options.service);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 500, { error: message });
    }
  });
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  service: SupervisorService,
): Promise<void> {
  if ((request.method ?? "GET") !== "GET") {
    response.setHeader("Allow", "GET");
    writeJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname === "/api/status") {
    const why = parseBooleanQueryValue(url.searchParams.get("why"));
    writeJson(response, 200, await service.queryStatus({ why }));
    return;
  }

  if (pathname === "/api/doctor") {
    writeJson(response, 200, await service.queryDoctor());
    return;
  }

  const explainMatch = pathname.match(/^\/api\/issues\/(\d+)\/explain$/u);
  if (explainMatch) {
    writeJson(response, 200, await service.queryExplain(Number.parseInt(explainMatch[1], 10)));
    return;
  }

  const issueLintMatch = pathname.match(/^\/api\/issues\/(\d+)\/issue-lint$/u);
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

function writeJson(response: http.ServerResponse, statusCode: number, body: JsonErrorBody | unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}
