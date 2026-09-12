import assert from "node:assert/strict";
import test from "node:test";
import {
  createGateState,
  DEFAULT_TURN_TAKING_CONFIG,
  transition,
  type GateState,
} from "./turn-taking-gate.js";

function apply(state: GateState, ...events: Parameters<typeof transition>[1][]): GateState {
  return events.reduce((current, event) => transition(current, event).state, state);
}

test("holds an intervention through a short pause and allows it only at a real opening", () => {
  let state = createGateState();
  state = apply(
    state,
    { type: "human_speech_started", at: 0 },
    { type: "human_speech_ended", at: 1_000 },
    { type: "candidate_ready", at: 1_050, candidateId: "critique-1" },
  );

  const early = transition(state, { type: "tick", at: 1_549 });
  assert.equal(early.state.phase, "holding");
  assert.deepEqual(early.actions, []);

  const opening = transition(early.state, {
    type: "tick",
    at: 1_000 + DEFAULT_TURN_TAKING_CONFIG.openingMinMs,
  });
  assert.equal(opening.state.phase, "opening");
  assert.deepEqual(opening.actions, [
    {
      type: "allow_candidate",
      candidateId: "critique-1",
      at: 1_900,
      silenceMs: 900,
    },
  ]);
});

test("discards a pending intervention that cannot find an opening before expiry", () => {
  let state = createGateState();
  state = apply(
    state,
    { type: "human_speech_started", at: 0 },
    { type: "candidate_ready", at: 100, candidateId: "stale-idea" },
  );

  const expired = transition(state, {
    type: "tick",
    at: 100 + DEFAULT_TURN_TAKING_CONFIG.interjectionExpiryMs,
  });
  assert.equal(expired.state.phase, "listening");
  assert.equal(expired.state.candidate, undefined);
  assert.deepEqual(expired.actions, [
    {
      type: "suppress_candidate",
      candidateId: "stale-idea",
      at: 2_600,
      reason: "candidate_expired",
    },
  ]);
});

test("suppresses an allowed candidate if a human resumes before the agent starts", () => {
  let state = createGateState();
  state = apply(
    state,
    { type: "human_speech_started", at: 0 },
    { type: "human_speech_ended", at: 1_000 },
    { type: "candidate_ready", at: 1_050, candidateId: "missed-gap" },
    { type: "tick", at: 1_900 },
  );

  const resumed = transition(state, { type: "human_speech_started", at: 1_950 });
  assert.equal(resumed.state.phase, "listening");
  assert.deepEqual(resumed.actions, [
    {
      type: "suppress_candidate",
      candidateId: "missed-gap",
      at: 1_950,
      reason: "human_resumed_before_agent_started",
    },
  ]);
});

test("cancels speech immediately when a human interrupts the agent", () => {
  let state = createGateState();
  state = apply(
    state,
    { type: "human_speech_started", at: 0 },
    { type: "human_speech_ended", at: 1_000 },
    { type: "candidate_ready", at: 1_050, candidateId: "spoken-idea" },
    { type: "tick", at: 1_900 },
    { type: "agent_audio_started", at: 1_920, candidateId: "spoken-idea" },
  );

  const interrupted = transition(state, { type: "human_speech_started", at: 2_000 });
  assert.equal(interrupted.state.phase, "listening");
  assert.equal(interrupted.state.candidate, undefined);
  assert.deepEqual(interrupted.actions, [
    { type: "cancel_agent_audio", candidateId: "spoken-idea", at: 2_000 },
  ]);
});

test("rejects non-monotonic event timestamps", () => {
  const state = apply(createGateState(), { type: "human_speech_started", at: 100 });
  assert.throws(
    () => transition(state, { type: "tick", at: 99 }),
    /moved backwards/,
  );
});
