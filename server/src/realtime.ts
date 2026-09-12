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

interface RealtimeSession {
  type: "realtime";
  model: string;
  instructions: string;
  output_modalities: ["audio"];
  max_output_tokens: number;
  audio: {
    output: {
      voice: string;
    };
  };
  turn_detection: {
    type: "server_vad";
    create_response: false;
    interrupt_response: false;
  };
}

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export const COUNTERPOINT_REALTIME_INSTRUCTIONS = [
  "You are Counterpoint, a concise cofacilitator embedded in a brainstorming meeting.",
  "Give at most one useful intervention: a concrete critique, alternative, or clarifying question.",
  "Do not interrupt people. The client decides when an opening exists and when to request your response.",
  "Distinguish evidence from hypotheses, state uncertainty, and never invent internal-company facts.",
  "Do not claim to have sent a message, changed a document, or taken any external action.",
].join(" ");

export function buildRealtimeSession(config: CounterpointConfig): RealtimeSession {
  return {
    type: "realtime",
    model: config.realtimeModel,
    instructions: COUNTERPOINT_REALTIME_INSTRUCTIONS,
    output_modalities: ["audio"],
    max_output_tokens: 300,
    audio: {
      output: {
        voice: config.realtimeVoice,
      },
    },
    // Realtime still segments speech for its conversation, but Counterpoint's
    // local gate is the only component allowed to request an intervention.
    turn_detection: {
      type: "server_vad",
      create_response: false,
      interrupt_response: false,
    },
  };
}

export async function createRealtimeCall(
  sdp: string,
  config: CounterpointConfig,
  fetchImpl: FetchLike = fetch,
): Promise<RealtimeCallResult> {
  if (!config.openAiApiKey) {
    throw new HttpProblem(503, "openai_not_configured", "OPENAI_API_KEY is not configured on the server.");
  }

  const { body, contentType } = encodeCallMultipart(sdp, buildRealtimeSession(config));
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
  session: RealtimeSession,
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
