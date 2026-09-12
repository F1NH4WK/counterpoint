import { randomUUID } from "node:crypto";

import type { CounterpointConfig } from "./config.js";
import { HttpProblem } from "./errors.js";

export interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface RealtimeCallResult {
  sdp: string;
  location?: string;
}

/**
 * The session object sent with the browser's WebRTC offer. It is produced by
 * the Agents SDK sideband session, rather than recreated in this transport
 * adapter, so the two control planes cannot drift.
 */
export interface RealtimeCallSession {
  type: "realtime";
  [key: string]: unknown;
}

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export async function createRealtimeCall(
  sdp: string,
  config: CounterpointConfig,
  session: RealtimeCallSession,
  fetchImpl: FetchLike = fetch,
): Promise<RealtimeCallResult> {
  if (!config.openAiApiKey) {
    throw new HttpProblem(503, "openai_not_configured", "OPENAI_API_KEY is not configured on the server.");
  }

  const { body, contentType } = encodeCallMultipart(sdp, session);
  const response = await fetchImpl(REALTIME_CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      Accept: "application/sdp",
      "Content-Type": contentType,
    },
    body,
  });

  const answer = await response.text();
  if (!response.ok) {
    throw new HttpProblem(
      502,
      "openai_realtime_rejected",
      `OpenAI rejected the Realtime call setup (upstream status ${response.status}).`,
    );
  }

  if (!answer.trim()) {
    throw new HttpProblem(502, "openai_realtime_empty_answer", "OpenAI returned an empty SDP answer.");
  }

  return {
    sdp: answer,
    location: response.headers.get("location") ?? undefined,
  };
}

export function encodeCallMultipart(
  sdp: string,
  session: RealtimeCallSession,
): { body: string; contentType: string } {
  const boundary = `----counterpoint-${randomUUID()}`;
  const content = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="sdp"',
    "Content-Type: application/sdp",
    "",
    sdp,
    `--${boundary}`,
    'Content-Disposition: form-data; name="session"',
    "Content-Type: application/json",
    "",
    JSON.stringify(session),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return {
    body: content,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * The provider's Call ID is private server-side control-plane state. The
 * browser only receives an opaque Counterpoint session ID.
 */
export function extractRealtimeCallId(location: string | undefined): string {
  const value = location?.trim();
  if (!value) {
    throw new HttpProblem(
      502,
      "openai_realtime_missing_call_id",
      "OpenAI did not return a Realtime call identifier for server-side controls.",
    );
  }

  const candidate = readCallIdCandidate(value);
  if (!candidate || !/^[A-Za-z0-9_-]{8,200}$/.test(candidate)) {
    throw new HttpProblem(
      502,
      "openai_realtime_invalid_call_id",
      "OpenAI returned an invalid Realtime call identifier.",
    );
  }
  return candidate;
}

function readCallIdCandidate(location: string): string | undefined {
  if (/^[A-Za-z0-9_-]+$/.test(location)) return location;

  try {
    const url = new URL(location, "https://api.openai.com");
    return url.pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}
