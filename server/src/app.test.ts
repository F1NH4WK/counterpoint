import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createCounterpointServer } from "./app.js";
import type { CounterpointConfig } from "./config.js";
import type { FetchLike } from "./realtime.js";

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

test("server accepts an allowed extension origin and never returns the OpenAI key", async (t) => {
  const fakeFetch: FetchLike = async () => new Response("v=0\r\nanswer", { status: 201 });
  const server = createCounterpointServer(config, { fetch: fakeFetch, logError: () => undefined });
  await listen(server);
  t.after(() => server.close());

  const response = await fetch(`${address(server)}/api/realtime/call`, {
    method: "POST",
    headers: {
      Origin: "chrome-extension://counterpoint-test",
      "Content-Type": "application/json",
      "X-Counterpoint-Demo-Token": "demo-token",
    },
    body: JSON.stringify({ sdp: "v=0\r\noffer" }),
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), "chrome-extension://counterpoint-test");
  const body = (await response.json()) as { sdp: string };
  assert.equal(body.sdp, "v=0\r\nanswer");
  assert.doesNotMatch(JSON.stringify(body), /test-key/);
});

test("server rejects unapproved browser origins before it reaches OpenAI", async (t) => {
  let called = false;
  const fakeFetch: FetchLike = async () => {
    called = true;
    return new Response("v=0", { status: 201 });
  };
  const server = createCounterpointServer(config, { fetch: fakeFetch, logError: () => undefined });
  await listen(server);
  t.after(() => server.close());

  const response = await fetch(`${address(server)}/api/realtime/call`, {
    method: "POST",
    headers: {
      Origin: "chrome-extension://some-other-extension",
      "Content-Type": "application/json",
      "X-Counterpoint-Demo-Token": "demo-token",
    },
    body: JSON.stringify({ sdp: "v=0\r\noffer" }),
  });

  assert.equal(response.status, 403);
  assert.equal(called, false);
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
