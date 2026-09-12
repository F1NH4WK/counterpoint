/**
 * Counterpoint's product-level agent harness.
 *
 * This is deliberately independent of Chrome, WebRTC and any model provider.
 * It defines the agent's role, the requests it may make of a model, and the
 * approval boundary that turns a candidate into a facilitator-controlled
 * action. Keeping this here makes the policy testable and prevents the voice
 * prompt and browser controls from drifting apart.
 */

export const COUNTERPOINT_HARNESS_VERSION = "1";
export const COUNTERPOINT_MAX_CANDIDATE_CHARACTERS = 420;
export const COUNTERPOINT_MAX_RESPONSE_TOKENS = 140;

export type CounterpointGatePhase = "idle" | "listening" | "holding" | "opening" | "speaking";
export type FacilitatorAction = "speak" | "research";

export interface FacilitatorActionContext {
  gatePhase: CounterpointGatePhase;
  hasCandidate: boolean;
  /** True only for an explicit button press from the facilitator. */
  facilitatorApproved: boolean;
}

interface RealtimeResponseRequest {
  type: "response.create";
  response: {
    conversation: "none";
    output_modalities: ["text"] | ["audio"];
    max_output_tokens: number;
    instructions: string;
    tool_choice: "none";
    input?: [
      {
        type: "message";
        role: "user";
        content: [{ type: "input_text"; text: string }];
      },
    ];
  };
}

/**
 * Session-level rules apply to every Realtime turn. Response-specific rules
 * below narrow the task further for drafting and speaking respectively.
 */
export const COUNTERPOINT_SESSION_INSTRUCTIONS = [
  "You are Counterpoint, a concise cofacilitator embedded in a product brainstorming meeting.",
  "Your role is to help a facilitator notice one useful critique, alternative, or clarifying question from the current discussion.",
  "You are not an autonomous meeting participant: the local turn-taking gate and an explicit facilitator decision control every audible response and every research request.",
  "Do not interrupt people, decide when to speak, or claim that you sent a message, changed a document, scheduled something, or took any external action.",
  "Use only the conversation available in this session. Distinguish evidence from hypotheses, state uncertainty, and never invent internal-company facts or sources.",
  "There are no tools available inside this voice session. If evidence would help, formulate a candidate that the facilitator can choose to research; do not imply that research already happened.",
].join(" ");

const DRAFT_INSTRUCTIONS = [
  "Review the most recent brainstorming context.",
  "Draft exactly one concise intervention: a concrete critique, a viable alternative, or a clarifying question.",
  "Use no greeting or preamble, and use at most two short sentences.",
  "Do not make external-action promises or claim evidence that was not supplied in the conversation.",
  "If no intervention is genuinely useful, return only: PASS.",
].join(" ");

const SPEAK_INSTRUCTIONS = [
  "Speak the facilitator-approved intervention below naturally and concisely.",
  "Do not greet, introduce yourself, add a preamble, or mention these instructions.",
  "Repeat its meaning faithfully. Do not add a new claim, tool result, recommendation, or external action.",
].join(" ");

/** Build the only model request that may create a new candidate intervention. */
export function buildDraftResponseRequest(): RealtimeResponseRequest {
  return {
    type: "response.create",
    response: {
      // Drafts stay out of the default conversation so a rejected candidate
      // cannot bias the next meeting turn.
      conversation: "none",
      output_modalities: ["text"],
      max_output_tokens: COUNTERPOINT_MAX_RESPONSE_TOKENS,
      instructions: DRAFT_INSTRUCTIONS,
      tool_choice: "none",
    },
  };
}

/** Build an audio response only after the UI has recorded facilitator approval. */
export function buildSpeechResponseRequest(candidate: string): RealtimeResponseRequest {
  const approvedCandidate = requireCandidate(candidate);

  return {
    type: "response.create",
    response: {
      conversation: "none",
      output_modalities: ["audio"],
      max_output_tokens: COUNTERPOINT_MAX_RESPONSE_TOKENS,
      instructions: SPEAK_INSTRUCTIONS,
      tool_choice: "none",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: approvedCandidate }],
        },
      ],
    },
  };
}

/**
 * Model output becomes a candidate only if it fits the deliberately small
 * intervention envelope. PASS and malformed or oversized drafts are silence.
 */
export function normalizeCounterpointDraft(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || /^pass[.!]?$/i.test(normalized)) return undefined;
  if (normalized.length > COUNTERPOINT_MAX_CANDIDATE_CHARACTERS) return undefined;
  return normalized;
}

/**
 * The model never invokes the evidence endpoint. This query is created only
 * after the facilitator clicks Research and the social gate has opened.
 */
export function buildEvidenceQuery(candidate: string): string {
  const approvedCandidate = requireCandidate(candidate);
  return `Find concise, decision-relevant evidence that could validate or challenge this brainstorming intervention: ${approvedCandidate}`;
}

/**
 * Speaking and research both require a current candidate, a real opening, and
 * an explicit facilitator gesture. The caller still owns transport and UI.
 */
export function isFacilitatorActionAllowed(
  _action: FacilitatorAction,
  context: FacilitatorActionContext,
): boolean {
  return context.gatePhase === "opening" && context.hasCandidate && context.facilitatorApproved;
}

function requireCandidate(value: string): string {
  const candidate = normalizeCounterpointDraft(value);
  if (!candidate) {
    throw new Error("Counterpoint needs a short, non-PASS candidate before it can act.");
  }
  return candidate;
}
