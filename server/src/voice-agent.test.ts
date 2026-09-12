import assert from "node:assert/strict";
import test from "node:test";

import type { CounterpointConfig } from "./config.js";
import { createVoiceAgentService } from "./voice-agent.js";

const config: CounterpointConfig = {
  host: "127.0.0.1",
  port: 8787,
  openAiApiKey: "test-key",
  realtimeModel: "gpt-realtime-2.1",
  realtimeVoice: "alloy",
  allowedOrigins: [],
  allowAnyChromeExtension: false,
};

test("sideband voice agent derives the browser call payload from the Agents SDK", async () => {
  const service = createVoiceAgentService({ logError: () => undefined });
  const sessionId = "counterpoint-test-session-0001";

  const payload = await service.prepare(sessionId, config);

  assert.equal(payload.type, "realtime");
  assert.equal(payload.model, "gpt-realtime-2.1");
  assert.equal(payload.tool_choice, "none");
  assert.deepEqual(payload.output_modalities, ["audio"]);
  assert.equal(readPath(payload, ["audio", "output", "voice"]), "alloy");
  assert.equal(readPath(payload, ["audio", "input", "turn_detection", "create_response"]), false);
  assert.match(String(payload.instructions), /not an autonomous meeting participant/i);
  assert.equal(service.getProjection(sessionId)?.status, "connecting");

  service.close(sessionId);
  assert.equal(service.getProjection(sessionId), undefined);
});

function readPath(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
