import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { CounterpointConfig } from "./config.js";
import { HttpProblem } from "./errors.js";
import { createRealtimeCall, type FetchLike } from "./realtime.js";
import {
  ExaOnboardingRequiredSearch,
  type EvidenceRequest,
  type EvidenceSearch,
} from "./research.js";

const MAX_JSON_BODY_BYTES = 256 * 1024;

export interface ServerDependencies {
  fetch?: FetchLike;
  evidenceSearch?: EvidenceSearch;
  logError?: (error: unknown) => void;
}

export function createCounterpointServer(
  config: CounterpointConfig,
  dependencies: ServerDependencies = {},
): Server {
  const evidenceSearch = dependencies.evidenceSearch ?? new ExaOnboardingRequiredSearch();
  const logError = dependencies.logError ?? console.error;

  return createServer((request, response) => {
    void handleRequest(request, response, config, {
      fetch: dependencies.fetch ?? fetch,
      evidenceSearch,
      logError,
    });
  });
}

interface ResolvedDependencies {
  fetch: FetchLike;
  evidenceSearch: EvidenceSearch;
  logError: (error: unknown) => void;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: CounterpointConfig,
  dependencies: ResolvedDependencies,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const origin = readHeader(request, "origin");

    if (url.pathname === "/health" && request.method === "GET") {
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      assertAllowedOrigin(origin, config);
      applyCors(response, origin, config);
      response.writeHead(204).end();
      return;
    }

    assertAllowedOrigin(origin, config);
    assertDemoToken(request, config);
    applyCors(response, origin, config);

    if (url.pathname === "/api/realtime/call" && request.method === "POST") {
      const body = await readJson(request);
      const sdp = readSdp(body);
      const result = await createRealtimeCall(sdp, config, dependencies.fetch);
      return sendJson(response, 201, result);
    }

    if (url.pathname === "/api/research" && request.method === "POST") {
      const requestBody = readEvidenceRequest(await readJson(request));
      const result = await dependencies.evidenceSearch.search(requestBody);
      return sendJson(response, 200, result);
    }

    throw new HttpProblem(404, "not_found", "Route not found.");
  } catch (error) {
    writeError(response, error, dependencies.logError);
  }
}

function assertAllowedOrigin(origin: string | undefined, config: CounterpointConfig): void {
  if (!origin) return;

  const allowed =
    config.allowedOrigins.includes(origin) ||
    (config.allowAnyChromeExtension && origin.startsWith("chrome-extension://"));

  if (!allowed) {
    throw new HttpProblem(403, "origin_not_allowed", "This browser origin is not allowed to call Counterpoint.");
  }
}

function assertDemoToken(request: IncomingMessage, config: CounterpointConfig): void {
  if (!config.demoToken) return;

  if (readHeader(request, "x-counterpoint-demo-token") !== config.demoToken) {
    throw new HttpProblem(401, "invalid_demo_token", "A valid Counterpoint demo token is required.");
  }
}

function applyCors(
  response: ServerResponse,
  origin: string | undefined,
  config: CounterpointConfig,
): void {
  if (!origin) return;
  if (
    config.allowedOrigins.includes(origin) ||
    (config.allowAnyChromeExtension && origin.startsWith("chrome-extension://"))
  ) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Counterpoint-Demo-Token");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Vary", "Origin");
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_JSON_BODY_BYTES) {
      request.destroy();
      throw new HttpProblem(413, "request_too_large", "Request body is too large.");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpProblem(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function readSdp(body: unknown): string {
  if (!isRecord(body) || typeof body.sdp !== "string" || !body.sdp.trim()) {
    throw new HttpProblem(400, "invalid_sdp", "A non-empty SDP offer is required.");
  }
  if (body.sdp.length > 200_000) {
    throw new HttpProblem(413, "sdp_too_large", "SDP offer is too large.");
  }
  return body.sdp;
}

function readEvidenceRequest(body: unknown): EvidenceRequest {
  if (!isRecord(body) || typeof body.query !== "string" || !body.query.trim()) {
    throw new HttpProblem(400, "invalid_query", "A non-empty research query is required.");
  }
  if (body.query.length > 2_000) {
    throw new HttpProblem(413, "query_too_large", "Research query is too large.");
  }
  if (body.depth !== undefined && body.depth !== "fast" && body.depth !== "deep") {
    throw new HttpProblem(400, "invalid_research_depth", "Research depth must be fast or deep.");
  }

  return { query: body.query.trim(), depth: body.depth ?? "fast" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function writeError(
  response: ServerResponse,
  error: unknown,
  logError: (error: unknown) => void,
): void {
  if (response.writableEnded) return;

  if (error instanceof HttpProblem) {
    sendJson(response, error.status, { error: error.message, code: error.code });
    return;
  }

  logError(error);
  sendJson(response, 500, {
    error: "Unexpected server error.",
    code: "internal_error",
  });
}
