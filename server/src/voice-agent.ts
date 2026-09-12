import {
  OpenAIRealtimeWebSocket,
  RealtimeAgent,
  RealtimeSession,
  type RealtimeSessionPayload,
} from "@openai/agents/realtime";

import {
  COUNTERPOINT_SESSION_INSTRUCTIONS,
  buildDraftResponseRequest,
  buildSpeechResponseRequest,
  normalizeCounterpointDraft,
} from "../../shared/src/counterpoint-harness.js";
import type { CounterpointConfig } from "./config.js";
import { HttpProblem } from "./errors.js";
import type { RealtimeCallSession } from "./realtime.js";

const MAX_PROJECTED_TEXT_CHARACTERS = 1_000;

export type VoiceAgentStatus = "connecting" | "listening" | "drafting" | "speaking" | "error";
export type VoiceAgentRequestKind = "draft" | "speech";
export type VoiceAgentRequestStatus = "in_progress" | "completed" | "cancelled" | "failed";

/**
 * A deliberately small, allowlisted projection of the server-side session.
 * It contains no provider event, call ID, transcript of meeting participants,
 * or credential. The extension only needs candidate text and its own audible
 * response transcript to render the facilitator flow.
 */
export interface VoiceAgentProjection {
  version: number;
  status: VoiceAgentStatus;
  detail: string;
  draft?: string;
  transcript?: string;
  response?: {
    kind: VoiceAgentRequestKind;
    status: VoiceAgentRequestStatus;
  };
}

export interface VoiceAgentService {
  /** Create the SDK session and return its CallAccept-compatible payload. */
  prepare(sessionId: string, config: CounterpointConfig): Promise<RealtimeCallSession>;
  /** Attach the SDK's WebSocket sideband to the private provider call ID. */
  connect(sessionId: string, callId: string): Promise<void>;
  getProjection(sessionId: string): VoiceAgentProjection | undefined;
  requestDraft(sessionId: string): void;
  requestSpeech(sessionId: string, candidate: string): void;
  cancel(sessionId: string): void;
  close(sessionId: string): void;
}

export interface VoiceAgentDependencies {
  logError?: (error: unknown) => void;
}

interface ManagedVoiceAgent {
  apiKey: string;
  closing: boolean;
  session: RealtimeSession;
  projection: VoiceAgentProjection;
  activeRequest?: { kind: VoiceAgentRequestKind };
}

/**
 * Builds Counterpoint's RealtimeAgent once per meeting and keeps the actual
 * RealtimeSession entirely on the server. Browser audio still travels directly
 * to OpenAI by WebRTC; this WebSocket is the sideband control plane prescribed
 * by the voice-agent guide.
 */
export function createVoiceAgentService(
  dependencies: VoiceAgentDependencies = {},
): VoiceAgentService {
  return new SidebandVoiceAgentService(dependencies.logError ?? console.error);
}

class SidebandVoiceAgentService implements VoiceAgentService {
  readonly #sessions = new Map<string, ManagedVoiceAgent>();

  constructor(private readonly logError: (error: unknown) => void) {}

  async prepare(sessionId: string, config: CounterpointConfig): Promise<RealtimeCallSession> {
    if (!config.openAiApiKey) {
      throw new HttpProblem(503, "openai_not_configured", "OPENAI_API_KEY is not configured on the server.");
    }
    if (this.#sessions.has(sessionId)) {
      throw new HttpProblem(409, "realtime_session_exists", "This Counterpoint session already exists.");
    }

    const agent = new RealtimeAgent({
      name: "Counterpoint",
      instructions: COUNTERPOINT_SESSION_INSTRUCTIONS,
      voice: config.realtimeVoice,
    });
    const session = new RealtimeSession(agent, {
      apiKey: config.openAiApiKey,
      model: config.realtimeModel,
      transport: "websocket",
      tracingDisabled: true,
      config: {
        outputModalities: ["audio"],
        audio: {
          input: {
            // Realtime may segment the meeting, but it never starts a reply by
            // itself. Only the Counterpoint harness asks for a response.
            turnDetection: {
              type: "server_vad",
              createResponse: false,
              interruptResponse: false,
            },
          },
          output: { voice: config.realtimeVoice },
        },
        toolChoice: "none",
        tools: [],
      },
    });
    const managed: ManagedVoiceAgent = {
      apiKey: config.openAiApiKey,
      closing: false,
      session,
      projection: {
        version: 1,
        status: "connecting",
        detail: "Preparing the server-side voice controls…",
      },
    };
    this.#attachProjectionListeners(managed);
    this.#sessions.set(sessionId, managed);

    try {
      const sdkSessionConfig = await session.getInitialSessionConfig();
      return serializeForRealtimeCall(session, sdkSessionConfig);
    } catch (error) {
      this.close(sessionId);
      throw error;
    }
  }

  async connect(sessionId: string, callId: string): Promise<void> {
    const managed = this.#requireSession(sessionId);
    try {
      await managed.session.connect({ apiKey: managed.apiKey, callId });
      this.#updateProjection(managed, {
        status: "listening",
        detail: "Server-side voice controls are listening.",
        response: undefined,
      });
    } catch (error) {
      this.#fail(managed, error);
      throw new HttpProblem(
        502,
        "openai_realtime_sideband_rejected",
        "OpenAI could not connect the server-side voice controls.",
      );
    }
  }

  getProjection(sessionId: string): VoiceAgentProjection | undefined {
    const projection = this.#sessions.get(sessionId)?.projection;
    return projection ? { ...projection, response: projection.response && { ...projection.response } } : undefined;
  }

  requestDraft(sessionId: string): void {
    const managed = this.#requireReadySession(sessionId);
    this.#startRequest(managed, "draft");
    try {
      managed.session.transport.sendEvent(buildDraftResponseRequest());
    } catch (error) {
      this.#fail(managed, error);
      throw new HttpProblem(502, "openai_realtime_command_failed", "Could not request a Counterpoint draft.");
    }
  }

  requestSpeech(sessionId: string, candidate: string): void {
    const managed = this.#requireReadySession(sessionId);
    let request: ReturnType<typeof buildSpeechResponseRequest>;
    try {
      request = buildSpeechResponseRequest(candidate);
    } catch {
      throw new HttpProblem(400, "invalid_candidate", "A short, non-PASS candidate is required before speaking.");
    }

    this.#startRequest(managed, "speech");
    try {
      managed.session.transport.sendEvent(request);
    } catch (error) {
      this.#fail(managed, error);
      throw new HttpProblem(502, "openai_realtime_command_failed", "Could not start the Counterpoint audio response.");
    }
  }

  cancel(sessionId: string): void {
    const managed = this.#requireSession(sessionId);
    const activeRequest = managed.activeRequest;
    if (!activeRequest) return;

    managed.activeRequest = undefined;
    try {
      // The SDK chooses the correct provider interruption sequence for the
      // WebSocket transport instead of exposing raw provider events to Chrome.
      managed.session.interrupt();
    } catch (error) {
      this.logError(error);
    }
    this.#updateProjection(managed, {
      status: "listening",
      detail: "The active Counterpoint response was cancelled.",
      response: { kind: activeRequest.kind, status: "cancelled" },
    });
  }

  close(sessionId: string): void {
    const managed = this.#sessions.get(sessionId);
    if (!managed) return;

    managed.closing = true;
    this.#sessions.delete(sessionId);
    try {
      managed.session.close();
    } catch (error) {
      this.logError(error);
    }
  }

  #requireSession(sessionId: string): ManagedVoiceAgent {
    const managed = this.#sessions.get(sessionId);
    if (!managed) {
      throw new HttpProblem(404, "realtime_session_not_found", "This Counterpoint voice session no longer exists.");
    }
    return managed;
  }

  #requireReadySession(sessionId: string): ManagedVoiceAgent {
    const managed = this.#requireSession(sessionId);
    if (managed.projection.status !== "listening" || managed.activeRequest) {
      throw new HttpProblem(409, "realtime_session_busy", "Counterpoint is not ready for another voice request.");
    }
    return managed;
  }

  #startRequest(managed: ManagedVoiceAgent, kind: VoiceAgentRequestKind): void {
    managed.activeRequest = { kind };
    this.#updateProjection(managed, {
      status: kind === "draft" ? "drafting" : "speaking",
      detail: kind === "draft" ? "Drafting one possible intervention." : "Speaking the facilitator-approved intervention.",
      draft: undefined,
      transcript: undefined,
      response: { kind, status: "in_progress" },
    });
  }

  #attachProjectionListeners(managed: ManagedVoiceAgent): void {
    const transport = managed.session.transport;

    transport.on("output_text_delta", (event) => {
      if (managed.activeRequest?.kind !== "draft") return;
      this.#updateProjection(managed, {
        draft: appendProjectedText(managed.projection.draft, event.delta),
      });
    });

    transport.on("audio_transcript_delta", (event) => {
      if (managed.activeRequest?.kind !== "speech") return;
      this.#updateProjection(managed, {
        transcript: appendProjectedText(managed.projection.transcript, event.delta),
      });
    });

    transport.on("turn_done", (event) => {
      const activeRequest = managed.activeRequest;
      if (!activeRequest) return;

      managed.activeRequest = undefined;
      if (activeRequest.kind === "draft") {
        const draft = normalizeCounterpointDraft(
          managed.projection.draft || extractResponseText(event.response.output),
        );
        this.#updateProjection(managed, {
          status: "listening",
          detail: draft ? "A candidate intervention is ready for the local gate." : "No intervention was queued for this turn.",
          draft,
          response: { kind: "draft", status: "completed" },
        });
        return;
      }

      const transcript =
        managed.projection.transcript || limitProjectedText(extractResponseText(event.response.output));
      this.#updateProjection(managed, {
        status: "listening",
        detail: "Counterpoint finished its local response.",
        transcript,
        response: { kind: "speech", status: "completed" },
      });
    });

    transport.on("error", (event) => {
      this.#fail(managed, event.error);
    });

    transport.on("connection_change", (status) => {
      if (status === "disconnected" && !managed.closing) {
        this.#fail(managed, new Error("The Realtime sideband disconnected."));
      }
    });
  }

  #fail(managed: ManagedVoiceAgent, error: unknown): void {
    if (managed.closing || managed.projection.status === "error") return;

    this.logError(error);
    const activeRequest = managed.activeRequest;
    managed.activeRequest = undefined;
    this.#updateProjection(managed, {
      status: "error",
      detail: "The server-side voice session could not complete its request.",
      response: activeRequest ? { kind: activeRequest.kind, status: "failed" } : undefined,
    });
  }

  #updateProjection(
    managed: ManagedVoiceAgent,
    update: Partial<Omit<VoiceAgentProjection, "version">>,
  ): void {
    managed.projection = {
      ...managed.projection,
      ...update,
      version: managed.projection.version + 1,
    };
  }
}

function serializeForRealtimeCall(
  session: RealtimeSession,
  config: Awaited<ReturnType<RealtimeSession["getInitialSessionConfig"]>>,
): RealtimeCallSession {
  const transport = session.transport;
  if (!(transport instanceof OpenAIRealtimeWebSocket)) {
    throw new Error("Counterpoint expected the Agents SDK WebSocket transport for its sideband session.");
  }
  return transport.buildSessionPayload(config) as RealtimeSessionPayload as RealtimeCallSession;
}

function appendProjectedText(previous: string | undefined, delta: string): string {
  return limitProjectedText(`${previous ?? ""}${delta}`);
}

function limitProjectedText(value: string): string {
  return value.slice(0, MAX_PROJECTED_TEXT_CHARACTERS);
}

function extractResponseText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .flatMap((part) => {
      if (!isRecord(part)) return [];
      return [part.text, part.transcript].filter((value): value is string => typeof value === "string");
    })
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
