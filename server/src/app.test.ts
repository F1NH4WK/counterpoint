import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createCounterpointServer } from "./app.js";
import type { CounterpointConfig } from "./config.js";
import type { FetchLike, RealtimeCallSession } from "./realtime.js";
import type { VoiceAgentProjection, VoiceAgentService } from "./voice-agent.js";

const config: CounterpointConfig = {
  host: "127.0.0.1",
  port: 8787,
  openAiApiKey: "test-key",
  realtimeModel: "gpt-realtime",
  realtimeVoice: "alloy",
  allowedOrigins: ["chrome-extension://counterpoint-test"],
  allowAnyChromeExtension: false,
  demoToken: "demo-token",
};

const AUDIO_ONLY_SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

class FakeVoiceAgent implements VoiceAgentService {
  readonly prepared: string[] = [];
  readonly connected: Array<{ sessionId: string; callId: string }> = [];
  readonly requested: Array<{ sessionId: string; kind: "draft" | "speech"; candidate?: string }> = [];
  readonly #projections = new Map<string, VoiceAgentProjection>();

  async prepare(sessionId: string): Promise<RealtimeCallSession> {
    this.prepared.push(sessionId);
    this.#projections.set(sessionId, {
      version: 1,
      status: "connecting",
      detail: "Preparing test sideband.",
    });
    return {
      type: "realtime",
      model: "gpt-realtime",
      instructions: "Test Counterpoint instructions.",
      output_modalities: ["audio"],
      tool_choice: "none",
    };
  }

  async connect(sessionId: string, callId: string): Promise<void> {
    this.connected.push({ sessionId, callId });
    this.#set(sessionId, { status: "listening", detail: "Test sideband connected." });
  }

  getProjection(sessionId: string): VoiceAgentProjection | undefined {
    const projection = this.#projections.get(sessionId);
    return projection && { ...projection, response: projection.response && { ...projection.response } };
  }

  requestDraft(sessionId: string): void {
    this.requested.push({ sessionId, kind: "draft" });
    this.#set(sessionId, {
      status: "drafting",
      detail: "Test draft requested.",
      response: { kind: "draft", status: "in_progress" },
    });
  }

  requestSpeech(sessionId: string, candidate: string): void {
    this.requested.push({ sessionId, kind: "speech", candidate });
    this.#set(sessionId, {
      status: "speaking",
      detail: "Test speech requested.",
      response: { kind: "speech", status: "in_progress" },
    });
  }

  cancel(sessionId: string): void {
    this.#set(sessionId, { status: "listening", detail: "Test request cancelled." });
  }

  close(sessionId: string): void {
    this.#projections.delete(sessionId);
  }

  #set(sessionId: string, update: Partial<Omit<VoiceAgentProjection, "version">>): void {
    const previous = this.#projections.get(sessionId);
    if (!previous) throw new Error("Expected a prepared test voice session.");
    this.#projections.set(sessionId, { ...previous, ...update, version: previous.version + 1 });
  }
}

test("server accepts an allowed extension origin and never returns the OpenAI key", async (t) => {
  const fakeVoiceAgent = new FakeVoiceAgent();
  const fakeFetch: FetchLike = async () =>
    new Response("v=0\r\nanswer", {
      status: 201,
      headers: { location: "https://api.openai.com/v1/realtime/calls/call_test_123" },
    });
  const server = createCounterpointServer(config, {
    fetch: fakeFetch,
    voiceAgent: fakeVoiceAgent,
    logError: () => undefined,
  });
  await listen(server);
  t.after(() => server.close());

  const response = await fetch(`${address(server)}/api/realtime/call`, {
    method: "POST",
    headers: {
      Origin: "chrome-extension://counterpoint-test",
      "Content-Type": "application/json",
      "X-Counterpoint-Demo-Token": "demo-token",
    },
    body: JSON.stringify({ sdp: AUDIO_ONLY_SDP }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), "chrome-extension://counterpoint-test");
  const body = (await response.json()) as { sdp: string; sessionId: string };
  assert.equal(body.sdp, "v=0\r\nanswer");
  assert.match(body.sessionId, /^[A-Za-z0-9-]{16,128}$/);
  assert.doesNotMatch(JSON.stringify(body), /test-key/);
  assert.doesNotMatch(JSON.stringify(body), /call_test_123/);
  assert.deepEqual(fakeVoiceAgent.connected, [{ sessionId: body.sessionId, callId: "call_test_123" }]);

  const projection = await fetch(`${address(server)}/api/realtime/sessions/${body.sessionId}`, {
    headers: {
      Origin: "chrome-extension://counterpoint-test",
      "X-Counterpoint-Demo-Token": "demo-token",
    },
  });
  assert.equal(projection.status, 200);
  assert.equal((await projection.json() as VoiceAgentProjection).status, "listening");
});

test("server rejects unapproved browser origins before it reaches OpenAI", async (t) => {
  let called = false;
  const fakeFetch: FetchLike = async () => {
    called = true;
    return new Response("v=0", { status: 201 });
  };
  const fakeVoiceAgent = new FakeVoiceAgent();
  const server = createCounterpointServer(config, {
    fetch: fakeFetch,
    voiceAgent: fakeVoiceAgent,
    logError: () => undefined,
  });
  await listen(server);
  t.after(() => server.close());

  const response = await fetch(`${address(server)}/api/realtime/call`, {
    method: "POST",
    headers: {
      Origin: "chrome-extension://some-other-extension",
      "Content-Type": "application/json",
      "X-Counterpoint-Demo-Token": "demo-token",
    },
    body: JSON.stringify({ sdp: AUDIO_ONLY_SDP }),
  });

  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.equal(fakeVoiceAgent.prepared.length, 0);
});

test("server accepts browser controls only through the opaque local session and rejects data channels", async (t) => {
  let called = false;
  const fakeVoiceAgent = new FakeVoiceAgent();
  const fakeFetch: FetchLike = async () => {
    called = true;
    return new Response("v=0\r\nanswer", {
      status: 201,
      headers: { location: "call_test_456" },
    });
  };
  const server = createCounterpointServer(config, {
    fetch: fakeFetch,
    voiceAgent: fakeVoiceAgent,
    logError: () => undefined,
  });
  await listen(server);
  t.after(() => server.close());

  const rejected = await fetch(`${address(server)}/api/realtime/call`, {
    method: "POST",
    headers: allowedHeaders(),
    body: JSON.stringify({ sdp: `${AUDIO_ONLY_SDP}m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n` }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(called, false);
  assert.equal(fakeVoiceAgent.prepared.length, 0);

  const created = await fetch(`${address(server)}/api/realtime/call`, {
    method: "POST",
    headers: allowedHeaders(),
    body: JSON.stringify({ sdp: AUDIO_ONLY_SDP }),
  });
  const createdBody = (await created.json()) as { sessionId: string };
  assert.equal(created.status, 201);

  const command = await fetch(`${address(server)}/api/realtime/sessions/${createdBody.sessionId}/draft`, {
    method: "POST",
    headers: allowedHeaders(),
  });
  assert.equal(command.status, 202);
  assert.deepEqual(fakeVoiceAgent.requested, [{ sessionId: createdBody.sessionId, kind: "draft" }]);
  assert.equal((await command.json() as VoiceAgentProjection).status, "drafting");
});

test("research route preserves its contract while Exa onboarding is pending", async (t) => {
  const server = createCounterpointServer(config, { logError: () => undefined });
  await listen(server);
  t.after(() => server.close());

  const response = await fetch(`${address(server)}/api/research`, {
    method: "POST",
    headers: {
      Origin: "chrome-extension://counterpoint-test",
      "Content-Type": "application/json",
      "X-Counterpoint-Demo-Token": "demo-token",
    },
    body: JSON.stringify({ query: "Is this premise supported?", depth: "fast" }),
  });

  assert.equal(response.status, 503);
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, "exa_onboarding_required");
});

async function listen(server: ReturnType<typeof createCounterpointServer>): Promise<void> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

function address(server: ReturnType<typeof createCounterpointServer>): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP server address.");
  return `http://127.0.0.1:${address.port}`;
}

function allowedHeaders(): Record<string, string> {
  return {
    Origin: "chrome-extension://counterpoint-test",
    "Content-Type": "application/json",
    "X-Counterpoint-Demo-Token": "demo-token",
  };
}
