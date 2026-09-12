/**
 * The product's core rule: a useful sentence spoken too late is worse than
 * silence. This module knows nothing about Chrome, audio codecs, React or an
 * LLM. It receives debounced speech events and produces deterministic actions.
 */

export const DEFAULT_TURN_TAKING_CONFIG = {
  /** A normal intra-sentence pause should never invite the agent in. */
  shortPauseMs: 550,
  /** Silence this long after human speech is an eligible opening. */
  openingMinMs: 900,
  /** A pending thought becomes stale if it cannot enter soon enough. */
  interjectionExpiryMs: 2_500,
} as const;

export type TurnTakingConfig = typeof DEFAULT_TURN_TAKING_CONFIG;

export type GatePhase = "idle" | "listening" | "holding" | "opening" | "speaking";

export type SuppressionReason =
  | "candidate_expired"
  | "human_resumed_before_agent_started";

export type Decision =
  | { kind: "allowed"; at: number; candidateId: string; silenceMs: number }
  | { kind: "suppressed"; at: number; candidateId: string; reason: SuppressionReason }
  | { kind: "cancelled"; at: number; candidateId: string; reason: "human_interrupted_agent" };

export type GateAction =
  | { type: "allow_candidate"; candidateId: string; at: number; silenceMs: number }
  | { type: "suppress_candidate"; candidateId: string; at: number; reason: SuppressionReason }
  | { type: "cancel_agent_audio"; candidateId: string; at: number };

export type GateEvent =
  | { type: "human_speech_started"; at: number }
  | { type: "human_speech_ended"; at: number }
  | { type: "candidate_ready"; at: number; candidateId: string }
  | { type: "agent_audio_started"; at: number; candidateId: string }
  | { type: "agent_audio_ended"; at: number; candidateId: string }
  | { type: "tick"; at: number };

interface Candidate {
  id: string;
  createdAt: number;
  allowedAt?: number;
}

export interface GateState {
  phase: GatePhase;
  humanIsSpeaking: boolean;
  lastHumanSpeechEndedAt?: number;
  candidate?: Candidate;
  lastDecision?: Decision;
  lastEventAt: number;
}

export interface GateTransition {
  state: GateState;
  actions: GateAction[];
}

export function createGateState(at = 0): GateState {
  return {
    phase: "idle",
    humanIsSpeaking: false,
    lastEventAt: at,
  };
}

export function transition(
  previous: GateState,
  event: GateEvent,
  config: TurnTakingConfig = DEFAULT_TURN_TAKING_CONFIG,
): GateTransition {
  assertConfig(config);
  assertMonotonicTime(previous, event);

  let state: GateState = { ...previous, lastEventAt: event.at };
  const actions: GateAction[] = [];

  switch (event.type) {
    case "human_speech_started": {
      if (state.phase === "speaking" && state.candidate) {
        actions.push({ type: "cancel_agent_audio", candidateId: state.candidate.id, at: event.at });
        state = {
          ...state,
          candidate: undefined,
          lastDecision: {
            kind: "cancelled",
            at: event.at,
            candidateId: state.candidate.id,
            reason: "human_interrupted_agent",
          },
        };
      } else if (state.phase === "opening" && state.candidate) {
        actions.push({
          type: "suppress_candidate",
          candidateId: state.candidate.id,
          at: event.at,
          reason: "human_resumed_before_agent_started",
        });
        state = {
          ...state,
          candidate: undefined,
          lastDecision: {
            kind: "suppressed",
            at: event.at,
            candidateId: state.candidate.id,
            reason: "human_resumed_before_agent_started",
          },
        };
      }

      state = { ...state, humanIsSpeaking: true, phase: "listening" };
      break;
    }

    case "human_speech_ended": {
      state = {
        ...state,
        humanIsSpeaking: false,
        lastHumanSpeechEndedAt: event.at,
        phase: state.candidate ? "holding" : "idle",
      };
      break;
    }

    case "candidate_ready": {
      if (state.candidate) {
        throw new Error("A turn-taking candidate is already pending.");
      }

      state = {
        ...state,
        candidate: { id: event.candidateId, createdAt: event.at },
        phase: state.humanIsSpeaking ? "holding" : "holding",
      };
      break;
    }

    case "agent_audio_started": {
      if (state.phase !== "opening" || state.candidate?.id !== event.candidateId) {
        throw new Error("Agent audio may start only after the gate allows its current candidate.");
      }
      state = { ...state, phase: "speaking" };
      break;
    }

    case "agent_audio_ended": {
      if (state.phase !== "speaking" || state.candidate?.id !== event.candidateId) {
        throw new Error("Only the active agent candidate may end audio.");
      }
      state = { ...state, candidate: undefined, phase: state.humanIsSpeaking ? "listening" : "idle" };
      break;
    }

    case "tick": {
      state = advanceTime(state, event.at, config, actions);
      break;
    }
  }

  return { state, actions };
}

function advanceTime(
  state: GateState,
  at: number,
  config: TurnTakingConfig,
  actions: GateAction[],
): GateState {
  const candidate = state.candidate;
  if (!candidate || candidate.allowedAt) return state;

  if (at - candidate.createdAt >= config.interjectionExpiryMs) {
    actions.push({ type: "suppress_candidate", candidateId: candidate.id, at, reason: "candidate_expired" });
    return {
      ...state,
      candidate: undefined,
      phase: state.humanIsSpeaking ? "listening" : "idle",
      lastDecision: { kind: "suppressed", at, candidateId: candidate.id, reason: "candidate_expired" },
    };
  }

  if (state.humanIsSpeaking || state.lastHumanSpeechEndedAt === undefined) return state;

  const silenceMs = at - state.lastHumanSpeechEndedAt;
  if (silenceMs < config.openingMinMs) {
    return { ...state, phase: "holding" };
  }

  actions.push({ type: "allow_candidate", candidateId: candidate.id, at, silenceMs });
  return {
    ...state,
    phase: "opening",
    candidate: { ...candidate, allowedAt: at },
    lastDecision: { kind: "allowed", at, candidateId: candidate.id, silenceMs },
  };
}

function assertMonotonicTime(state: GateState, event: GateEvent): void {
  if (event.at < state.lastEventAt) {
    throw new RangeError(`Turn-taking event time moved backwards: ${event.at} < ${state.lastEventAt}.`);
  }
}

function assertConfig(config: TurnTakingConfig): void {
  if (
    config.shortPauseMs < 0 ||
    config.openingMinMs <= config.shortPauseMs ||
    config.interjectionExpiryMs <= config.openingMinMs
  ) {
    throw new RangeError("Turn-taking thresholds must satisfy 0 <= shortPause < opening < expiry.");
  }
}
