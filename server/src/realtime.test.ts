import assert from "node:assert/strict";
import test from "node:test";

import type { CounterpointConfig } from "./config.js";
import { HttpProblem } from "./errors.js";
import {
  createRealtimeCall,
  encodeCallMultipart,
  extractRealtimeCallId,
  type FetchLike,
  type RealtimeCallSession,
} from "./realtime.js";

const config: CounterpointConfig = {
  host: "127.0.0.1",
  port: 8787,
  openAiApiKey: "test-key",
  realtimeModel: "gpt-realtime",
  realtimeVoice: "alloy",
  allowedOrigins: [],
  allowAnyChromeExtension: false,
};

const session: RealtimeCallSession = {
  type: "realtime",
  model: "gpt-realtime",
  instructions: "Counterpoint session instructions produced by the Agents SDK.",
  output_modalities: ["audio"],
  tool_choice: "none",
  audio: {
    input: { turn_detection: { type: "server_vad", create_response: false } },
    output: { voice: "alloy" },
  },
};

test("multipart payload contains a typed SDP field and JSON session field", () => {
  const { body, contentType } = encodeCallMultipart("v=0\r\n", session);

  assert.match(contentType, /^multipart\/form-data; boundary=----counterpoint-/);
  assert.match(body, /name="sdp"\r\nContent-Type: application\/sdp\r\n\r\nv=0/);
  assert.match(body, /name="session"\r\nContent-Type: application\/json/);
  assert.match(body, /"model":"gpt-realtime"/);
  assert.match(body, /"tool_choice":"none"/);
});

test("createRealtimeCall forwards only the server-held key and returns the SDP answer", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fakeFetch: FetchLike = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response("v=0\r\nanswer", {
      status: 201,
      headers: { location: "https://api.openai.com/v1/realtime/calls/call_123" },
    });
  };

  const result = await createRealtimeCall("v=0\r\noffer", config, session, fakeFetch);

  assert.equal(capturedUrl, "https://api.openai.com/v1/realtime/calls");
  assert.equal(capturedInit?.headers && new Headers(capturedInit.headers).get("authorization"), "Bearer test-key");
  assert.equal(result.sdp, "v=0\r\nanswer");
  assert.equal(result.location, "https://api.openai.com/v1/realtime/calls/call_123");
  assert.doesNotMatch(capturedInit?.body as string, /test-key/);
});

test("createRealtimeCall fails safely when the provider rejects the call", async () => {
  const fakeFetch: FetchLike = async () => new Response("provider detail", { status: 401 });

  await assert.rejects(
    () => createRealtimeCall("v=0", config, session, fakeFetch),
    (error: unknown) =>
      error instanceof HttpProblem &&
      error.status === 502 &&
      error.code === "openai_realtime_rejected" &&
      !error.message.includes("provider detail"),
  );
});

test("extractRealtimeCallId accepts provider locations but rejects missing or malformed values", () => {
  assert.equal(
    extractRealtimeCallId("https://api.openai.com/v1/realtime/calls/call_123"),
    "call_123",
  );
  assert.equal(extractRealtimeCallId("call_abc-123"), "call_abc-123");

  assert.throws(
    () => extractRealtimeCallId(undefined),
    (error: unknown) => error instanceof HttpProblem && error.code === "openai_realtime_missing_call_id",
  );
  assert.throws(
    () => extractRealtimeCallId("https://api.openai.com/v1/realtime/calls/not valid"),
    (error: unknown) => error instanceof HttpProblem && error.code === "openai_realtime_invalid_call_id",
  );
});
