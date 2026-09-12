import {
  DEFAULT_TURN_TAKING_CONFIG,
  createGateState,
  transition,
  type GateAction,
  type GateEvent,
  type GateState,
} from "../../shared/src/turn-taking-gate.js";
import { COUNTERPOINT_DEMO_TOKEN, COUNTERPOINT_SERVER_URL } from "./config.js";
import {
  INITIAL_EVIDENCE_SNAPSHOT,
  INITIAL_AGENT_SNAPSHOT,
  INITIAL_CAPTURE_SNAPSHOT,
  type AgentSnapshot,
  type CaptureSnapshot,
  type EvidenceSnapshot,
  type EvidenceSource,
  type ExtensionMessage,
} from "./protocol.js";

const SAMPLE_INTERVAL_MS = 120;
const SPEECH_THRESHOLD = 0.017;
const SPEECH_DEBOUNCE_MS = 180;
const DRAFT_AFTER_SPEECH_MS = DEFAULT_TURN_TAKING_CONFIG.shortPauseMs;
const ICE_GATHERING_TIMEOUT_MS = 6_000;
const DATA_CHANNEL_TIMEOUT_MS = 10_000;
const DEMO_SPEECH_DURATION_MS = 1_600;

const DEMO_CANDIDATE_TEXT =
  "Before we build the full integration, what evidence in week one would prove teams want synchronous critique rather than a meeting summary?";

const DEMO_EVIDENCE_SOURCES: EvidenceSource[] = [
  {
    title: "Demo citation card — not a live source",
    url: "https://example.com/counterpoint-demo-evidence-1",
    highlight: "This canned card demonstrates where a cited Exa result will appear after onboarding is configured.",
  },
  {
    title: "Demo counterexample card — not a live source",
    url: "https://example.com/counterpoint-demo-evidence-2",
    highlight: "The second card makes the review surface testable without claiming that a live search occurred.",
  },
];

let activeCapture: ActiveCapture | undefined;
let activeAgent: ActiveAgent | undefined;
let activeMode: "live" | "demo" | undefined;
let pendingSpeech: { value: boolean; since: number } | undefined;
let pendingCandidateTimer: number | undefined;
let demoSpeechTimer: number | undefined;
let gateState = createGateState(performance.now());
let candidate: Candidate | undefined;
let agentSnapshot: AgentSnapshot = INITIAL_AGENT_SNAPSHOT;
let evidence: EvidenceSnapshot = emptyEvidence();

interface ActiveCapture {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  samples: Uint8Array<ArrayBuffer>;
  timer: number;
  snapshot: CaptureSnapshot;
}

interface ActiveAgent {
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  outputAudio: HTMLAudioElement;
  stage: "connecting" | "listening" | "drafting" | "speaking";
  draft: string;
  spokenTranscript: string;
  activeCandidateId?: string;
}

interface Candidate {
  id: string;
  text: string;
}

type RealtimeEvent = {
  type?: unknown;
  delta?: unknown;
  error?: { message?: unknown };
  response?: {
    status?: unknown;
    output?: unknown;
  };
};

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "capture_tab_audio" && message.source === "background") {
    void startCapture(message);
  }
  if (message.type === "stop_capture" && message.source === "background") {
    void stopCapture("Capture stopped by the user.");
  }
  if (message.type === "start_agent" && message.source === "background") {
    void startAgent();
  }
  if (message.type === "stop_agent" && message.source === "background") {
    void stopAgent("Voice cofacilitator stopped by the user.");
  }
  if (message.type === "speak_candidate" && message.source === "background") {
    void speakReadyCandidate();
  }
  if (message.type === "discard_candidate" && message.source === "background") {
    void discardCandidate();
  }
  if (message.type === "research_candidate" && message.source === "background") {
    void researchCandidate();
  }
  if (message.type === "run_demo" && message.source === "background") {
    void runDemo();
  }
});

async function startCapture(message: Extract<ExtensionMessage, { type: "capture_tab_audio" }>): Promise<void> {
  await stopCapture("Replacing the previous tab capture.", false);
  await publishCapture({
    status: "connecting",
    tabId: message.tabId,
    tabTitle: message.tabTitle,
    level: 0,
    speech: false,
    detail: "Connecting to local tab audio…",
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: message.streamId,
        },
      } as unknown as MediaTrackConstraints,
      video: false,
    });

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2_048;
    const samples = new Uint8Array(analyser.fftSize);

    // Chrome mutes captured tab audio unless the extension routes it back to an
    // audio destination. This preserves the meeting for the person testing.
    source.connect(analyser);
    source.connect(context.destination);
    await context.resume();

    const snapshot: CaptureSnapshot = {
      status: "capturing",
      tabId: message.tabId,
      tabTitle: message.tabTitle,
      level: 0,
      speech: false,
      detail: "Capturing Meet tab audio locally. Start the cofacilitator to send it to OpenAI.",
    };
    const timer = self.setInterval(() => sampleAudio(), SAMPLE_INTERVAL_MS);
    activeCapture = { stream, context, analyser, samples, timer, snapshot };
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        void stopCapture("Chrome ended the tab-audio stream.");
      });
    });
    await publishCapture(snapshot);
  } catch (cause) {
    await publishCapture({
      ...INITIAL_CAPTURE_SNAPSHOT,
      status: "error",
      detail: cause instanceof Error ? cause.message : "Could not start local tab-audio capture.",
    });
  }
}

async function startAgent(): Promise<void> {
  if (activeMode === "demo") {
    await stopAgent("Demo mode ended.", false);
  }

  const capture = activeCapture;
  if (!capture) {
    await publishAgent({
      status: "error",
      gatePhase: "idle",
      detail: "Start Google Meet tab capture before starting Counterpoint.",
    });
    return;
  }

  if (activeAgent) {
    await publishAgent({
      ...agentSnapshot,
      detail: "The voice cofacilitator is already connected.",
    });
    return;
  }

  activeMode = "live";
  evidence = emptyEvidence();
  resetGate();
  await publishAgent({
    status: "connecting",
    gatePhase: gateState.phase,
    detail: "Opening a private Realtime connection through the local server…",
  });

  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  const outputAudio = new Audio();
  outputAudio.autoplay = true;
  const agent: ActiveAgent = {
    peer,
    channel,
    outputAudio,
    stage: "connecting",
    draft: "",
    spokenTranscript: "",
  };
  activeAgent = agent;

  peer.addEventListener("track", (event) => {
    const stream = event.streams[0];
    if (stream) void playAgentAudio(agent, stream);
  });
  peer.addEventListener("connectionstatechange", () => {
    if (activeAgent !== agent) return;
    if (peer.connectionState === "failed") {
      void stopAgent("The Realtime connection failed.");
    }
  });
  channel.addEventListener("message", (event) => handleRealtimeMessage(agent, event.data));

  try {
    for (const track of capture.stream.getAudioTracks()) {
      peer.addTrack(track, capture.stream);
    }

    await peer.setLocalDescription(await peer.createOffer());
    await waitForIceGathering(peer);
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("The browser did not produce a WebRTC offer.");

    const answer = await requestRealtimeAnswer(sdp);
    await peer.setRemoteDescription({ type: "answer", sdp: answer });
    await waitForDataChannel(channel);

    if (activeAgent !== agent) return;
    agent.stage = "listening";
    if (capture.snapshot.speech) {
      advanceGate({ type: "human_speech_started", at: performance.now() });
    }
    reflectGate("Listening to the meeting. Drafts wait for a real opening before they can speak.");
  } catch (cause) {
    if (activeAgent === agent) {
      activeAgent = undefined;
      closeAgentResources(agent);
    }
    activeMode = undefined;
    await publishAgent({
      status: "error",
      gatePhase: gateState.phase,
      detail: cause instanceof Error ? cause.message : "Could not connect to Realtime.",
    });
  }
}

function sampleAudio(): void {
  const capture = activeCapture;
  if (!capture) return;

  capture.analyser.getByteTimeDomainData(capture.samples);
  const level = rms(capture.samples);
  const rawSpeech = level >= SPEECH_THRESHOLD;
  const now = performance.now();

  if (!pendingSpeech || pendingSpeech.value !== rawSpeech) {
    pendingSpeech = { value: rawSpeech, since: now };
  }

  const speech =
    now - pendingSpeech.since >= SPEECH_DEBOUNCE_MS ? pendingSpeech.value : capture.snapshot.speech;
  const previousSpeech = capture.snapshot.speech;
  const snapshot: CaptureSnapshot = { ...capture.snapshot, level, speech };
  activeCapture = { ...capture, snapshot };
  void publishCapture(snapshot);

  if (activeAgent && speech !== previousSpeech) {
    if (speech) {
      clearPendingCandidateDraft();
      advanceGate({ type: "human_speech_started", at: now });
      reflectGate("Human speech detected. Any intervention remains held.");
    } else {
      advanceGate({ type: "human_speech_ended", at: now });
      reflectGate("A pause was detected. Checking whether a useful intervention is worth drafting.");
      scheduleCandidateDraft();
    }
  }

  if (activeAgent) {
    advanceGate({ type: "tick", at: now });
  }
}

function scheduleCandidateDraft(): void {
  clearPendingCandidateDraft();
  pendingCandidateTimer = self.setTimeout(() => {
    pendingCandidateTimer = undefined;
    requestCandidateDraft();
  }, DRAFT_AFTER_SPEECH_MS);
}

function clearPendingCandidateDraft(): void {
  if (pendingCandidateTimer === undefined) return;
  self.clearTimeout(pendingCandidateTimer);
  pendingCandidateTimer = undefined;
}

function requestCandidateDraft(): void {
  const agent = activeAgent;
  const capture = activeCapture;
  if (!agent || !capture || capture.snapshot.speech || candidate || agent.stage !== "listening") return;
  if (agent.channel.readyState !== "open") return;

  agent.stage = "drafting";
  agent.draft = "";
  reflectGate("Drafting one concise critique, alternative, or question from the current discussion.");

  try {
    agent.channel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["text"],
          max_output_tokens: 140,
          instructions: [
            "Review the most recent brainstorming context.",
            "Draft exactly one concise intervention: a critique, alternative, or clarifying question.",
            "Use no greeting, no preamble, and at most two short sentences.",
            "If no intervention is genuinely useful, return only: PASS.",
          ].join(" "),
        },
      }),
    );
  } catch (cause) {
    agent.stage = "listening";
    reflectGate(cause instanceof Error ? cause.message : "Could not request a draft.");
  }
}

function handleRealtimeMessage(agent: ActiveAgent, rawData: unknown): void {
  if (activeAgent !== agent || typeof rawData !== "string") return;

  let event: RealtimeEvent;
  try {
    event = JSON.parse(rawData) as RealtimeEvent;
  } catch {
    return;
  }

  const type = typeof event.type === "string" ? event.type : "";
  if (type === "response.text.delta" || type === "response.output_text.delta") {
    if (agent.stage === "drafting" && typeof event.delta === "string") {
      agent.draft += event.delta;
    }
    return;
  }

  if (type === "response.output_audio_transcript.delta" && typeof event.delta === "string") {
    if (agent.stage === "speaking") {
      agent.spokenTranscript += event.delta;
      void publishAgent({ ...agentSnapshot, transcript: agent.spokenTranscript });
    }
    return;
  }

  if (type === "response.done") {
    finishRealtimeResponse(agent, event);
    return;
  }

  if (type === "error") {
    const detail = typeof event.error?.message === "string" ? event.error.message : "Realtime returned an error.";
    if (agent.stage === "drafting") {
      agent.stage = "listening";
      reflectGate(`Could not draft an intervention: ${detail}`);
      return;
    }
    void publishAgent({ status: "error", gatePhase: gateState.phase, detail, intervention: candidate?.text });
  }
}

function finishRealtimeResponse(agent: ActiveAgent, event: RealtimeEvent): void {
  const responseStatus = typeof event.response?.status === "string" ? event.response.status : "completed";

  if (agent.stage === "drafting") {
    agent.stage = "listening";
    const text = normalizeDraft(agent.draft || extractResponseText(event.response?.output));
    agent.draft = "";
    if (responseStatus === "cancelled" || !text || text === "PASS") {
      reflectGate("No intervention was queued for this turn.");
      return;
    }

    candidate = { id: crypto.randomUUID(), text };
    evidence = emptyEvidence("A suggestion is ready. Research it before deciding whether to speak it.");
    advanceGate({ type: "candidate_ready", at: performance.now(), candidateId: candidate.id });
    reflectGate("A possible intervention is ready and waiting for a social opening.");
    return;
  }

  if (agent.stage === "speaking") {
    const candidateId = agent.activeCandidateId;
    agent.stage = "listening";
    agent.activeCandidateId = undefined;
    if (candidateId && gateState.phase === "speaking" && gateState.candidate?.id === candidateId) {
      advanceGate({ type: "agent_audio_ended", at: performance.now(), candidateId });
    }
    reflectGate(responseStatus === "cancelled" ? "Counterpoint stopped because the conversation resumed." : "Counterpoint is listening again.");
  }
}

function advanceGate(event: GateEvent): void {
  let result: ReturnType<typeof transition>;
  try {
    result = transition(gateState, event);
  } catch (cause) {
    void publishAgent({
      status: "error",
      gatePhase: gateState.phase,
      detail: cause instanceof Error ? cause.message : "Turn-taking gate failed.",
    });
    return;
  }

  gateState = result.state;
  for (const action of result.actions) {
    void handleGateAction(action);
  }
}

async function handleGateAction(action: GateAction): Promise<void> {
  if (action.type === "allow_candidate") {
    if (candidate?.id === action.candidateId) {
      reflectGate("A real opening is available. Review, research, speak, or discard this suggestion.");
    }
    return;
  }

  if (action.type === "suppress_candidate") {
    if (candidate?.id === action.candidateId) candidate = undefined;
    evidence = emptyEvidence();
    reflectGate(
      action.reason === "candidate_expired"
        ? "A stale intervention was discarded."
        : "A person resumed speaking, so the intervention was discarded.",
    );
    return;
  }

  if (action.type === "cancel_agent_audio") {
    await cancelAgentAudio(action.candidateId);
  }
}

async function speakReadyCandidate(): Promise<void> {
  const nextCandidate = candidate;
  if (!nextCandidate || gateState.phase !== "opening") {
    await publishAgent({
      status: currentAgentStatus(),
      gatePhase: gateState.phase,
      detail: "There is no eligible suggestion to speak yet.",
      intervention: candidate?.text,
      transcript: activeAgent?.spokenTranscript || undefined,
    });
    return;
  }

  await speakCandidate(nextCandidate);
}

async function speakCandidate(nextCandidate: Candidate): Promise<void> {
  if (candidate?.id !== nextCandidate.id || gateState.phase !== "opening") return;

  if (activeMode === "demo") {
    await speakDemoCandidate(nextCandidate);
    return;
  }

  const agent = activeAgent;
  if (!agent || agent.stage !== "listening" || agent.channel.readyState !== "open") {
    await publishAgent({
      status: "error",
      gatePhase: gateState.phase,
      detail: "Counterpoint is not connected well enough to speak this suggestion.",
      intervention: nextCandidate.text,
      transcript: activeAgent?.spokenTranscript || undefined,
    });
    return;
  }

  try {
    agent.channel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          conversation: "none",
          output_modalities: ["audio"],
          max_output_tokens: 140,
          instructions: [
            "Speak the intervention below naturally and concisely.",
            "Do not greet, introduce yourself, add a preamble, or mention this instruction.",
            "Do not add any new claim beyond the intervention.",
          ].join(" "),
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: nextCandidate.text }],
            },
          ],
        },
      }),
    );
  } catch (cause) {
    reflectGate(cause instanceof Error ? cause.message : "Could not start the intervention audio.");
    return;
  }

  agent.stage = "speaking";
  agent.activeCandidateId = nextCandidate.id;
  agent.spokenTranscript = "";
  advanceGate({ type: "agent_audio_started", at: performance.now(), candidateId: nextCandidate.id });
  void publishAgent({
    status: "speaking",
    gatePhase: gateState.phase,
    detail: "Opening found. Counterpoint is speaking locally.",
    intervention: nextCandidate.text,
    transcript: "",
  });
}

async function speakDemoCandidate(nextCandidate: Candidate): Promise<void> {
  clearDemoSpeechTimer();
  advanceGate({ type: "agent_audio_started", at: performance.now(), candidateId: nextCandidate.id });
  await publishAgent({
    status: "speaking",
    gatePhase: gateState.phase,
    detail: "Demo: Counterpoint is simulating a local whisper to the facilitator.",
    intervention: nextCandidate.text,
    transcript: "",
  });

  demoSpeechTimer = self.setTimeout(() => {
    demoSpeechTimer = undefined;
    if (
      activeMode !== "demo" ||
      candidate?.id !== nextCandidate.id ||
      gateState.phase !== "speaking"
    ) {
      return;
    }

    advanceGate({ type: "agent_audio_ended", at: performance.now(), candidateId: nextCandidate.id });
    void publishAgent({
      status: "listening",
      gatePhase: gateState.phase,
      detail: "Demo complete. Run it again to review another facilitator decision.",
      transcript: nextCandidate.text,
    });
  }, DEMO_SPEECH_DURATION_MS);
}

async function discardCandidate(): Promise<void> {
  const nextCandidate = candidate;
  if (!nextCandidate) {
    await publishAgent({
      status: currentAgentStatus(),
      gatePhase: gateState.phase,
      detail: "There is no suggestion to discard.",
      transcript: activeAgent?.spokenTranscript || undefined,
    });
    return;
  }

  if (gateState.phase === "speaking") {
    await publishAgent({
      status: "speaking",
      gatePhase: gateState.phase,
      detail: "A spoken intervention can only be stopped by a human interruption.",
      intervention: nextCandidate.text,
      transcript: activeAgent?.spokenTranscript || undefined,
    });
    return;
  }

  advanceGate({ type: "candidate_discarded", at: performance.now(), candidateId: nextCandidate.id });
  candidate = undefined;
  evidence = emptyEvidence("The suggestion was discarded. Counterpoint will wait for the next useful moment.");
  reflectGate("You discarded the suggestion. Counterpoint is listening again.");
}

async function researchCandidate(): Promise<void> {
  const nextCandidate = candidate;
  if (!nextCandidate || gateState.phase !== "opening") {
    await publishAgent({
      status: currentAgentStatus(),
      gatePhase: gateState.phase,
      detail: "Research becomes available once a suggestion reaches a real opening.",
      intervention: candidate?.text,
      transcript: activeAgent?.spokenTranscript || undefined,
    });
    return;
  }

  evidence = {
    status: "loading",
    detail: "Looking for decision-relevant evidence…",
    sources: [],
  };
  reflectGate("Researching evidence for this suggestion. The facilitator still controls what happens next.");

  if (activeMode === "demo") {
    evidence = {
      status: "ready",
      detail: "Demo evidence only — configure Exa onboarding to show live, cited research.",
      sources: DEMO_EVIDENCE_SOURCES,
    };
    if (candidate?.id === nextCandidate.id) {
      reflectGate("Demo evidence is ready. These cards are deliberately labelled as non-live sources.");
    }
    return;
  }

  try {
    const result = await requestEvidence(nextCandidate.text);
    if (candidate?.id !== nextCandidate.id) return;

    evidence = {
      status: "ready",
      detail: result.summary ?? `${result.sources.length} evidence source${result.sources.length === 1 ? "" : "s"} ready for review.`,
      sources: result.sources,
    };
    reflectGate("Evidence is ready. Review it before choosing whether to speak the suggestion.");
  } catch (cause) {
    if (candidate?.id !== nextCandidate.id) return;
    evidence = {
      status: "error",
      detail: cause instanceof Error ? cause.message : "Could not retrieve evidence.",
      sources: [],
    };
    reflectGate("Research is not configured yet; the suggestion remains under facilitator control.");
  }
}

async function runDemo(): Promise<void> {
  await stopAgent("Switching to demo mode.", false);
  activeMode = "demo";
  evidence = emptyEvidence("Demo mode uses a canned suggestion and no meeting audio or network request.");

  const now = performance.now();
  gateState = createGateState(now - 1_000);
  candidate = { id: crypto.randomUUID(), text: DEMO_CANDIDATE_TEXT };
  advanceGate({ type: "human_speech_started", at: now - 1_000 });
  advanceGate({ type: "human_speech_ended", at: now - 950 });
  advanceGate({ type: "candidate_ready", at: now - 900, candidateId: candidate.id });
  advanceGate({ type: "tick", at: now });

  await publishAgent({
    status: "ready",
    gatePhase: gateState.phase,
    detail: "Demo mode: a valid conversational opening was detected. Choose what Counterpoint should do.",
    intervention: candidate.text,
    transcript: undefined,
  });
}

async function cancelAgentAudio(candidateId: string): Promise<void> {
  const agent = activeAgent;
  if (!agent || agent.activeCandidateId !== candidateId || agent.channel.readyState !== "open") return;

  try {
    agent.channel.send(JSON.stringify({ type: "response.cancel" }));
    agent.channel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
  } catch {
    // The peer can already be closing; the gate has still made the safe choice.
  }
  agent.stage = "listening";
  agent.activeCandidateId = undefined;
  candidate = undefined;
  reflectGate("Human speech interrupted Counterpoint, so its audio was cancelled.");
}

function reflectGate(detail: string): void {
  if (!activeAgent && activeMode !== "demo") return;

  void publishAgent({
    status: currentAgentStatus(),
    gatePhase: gateState.phase,
    detail,
    intervention: candidate?.text,
    transcript: activeAgent?.spokenTranscript || undefined,
  });
}

function currentAgentStatus(): AgentSnapshot["status"] {
  if (activeAgent?.stage === "drafting") return "drafting";
  if (activeAgent?.stage === "speaking") return "speaking";
  if (gateState.phase === "opening" && candidate) return "ready";
  if (gateState.phase === "holding" && candidate) return "holding";
  if (activeAgent?.stage === "connecting") return "connecting";
  if (activeAgent || activeMode === "demo") return "listening";
  return "idle";
}

async function requestRealtimeAnswer(sdp: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (COUNTERPOINT_DEMO_TOKEN) headers["X-Counterpoint-Demo-Token"] = COUNTERPOINT_DEMO_TOKEN;

  const response = await fetch(`${COUNTERPOINT_SERVER_URL}/api/realtime/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sdp }),
  });
  const body = (await response.json().catch(() => undefined)) as
    | { sdp?: unknown; error?: unknown }
    | undefined;

  if (!response.ok || typeof body?.sdp !== "string") {
    const message = typeof body?.error === "string" ? body.error : "The local server refused the Realtime call.";
    throw new Error(message);
  }
  return body.sdp;
}

async function requestEvidence(intervention: string): Promise<{ sources: EvidenceSource[]; summary?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (COUNTERPOINT_DEMO_TOKEN) headers["X-Counterpoint-Demo-Token"] = COUNTERPOINT_DEMO_TOKEN;

  const response = await fetch(`${COUNTERPOINT_SERVER_URL}/api/research`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      depth: "fast",
      query: `Find concise, decision-relevant evidence that could validate or challenge this brainstorming intervention: ${intervention}`,
    }),
  });
  const body = (await response.json().catch(() => undefined)) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : "The local server could not retrieve evidence.";
    throw new Error(message);
  }
  if (!isRecord(body)) {
    throw new Error("The local server returned an invalid evidence response.");
  }

  return {
    sources: readEvidenceSources(body.sources),
    summary: typeof body.summary === "string" ? body.summary : undefined,
  };
}

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = self.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while gathering WebRTC candidates."));
    }, ICE_GATHERING_TIMEOUT_MS);
    const onStateChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      self.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onStateChange);
    };
    peer.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function waitForDataChannel(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = self.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while opening the Realtime data channel."));
    }, DATA_CHANNEL_TIMEOUT_MS);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The Realtime data channel could not open."));
    };
    const cleanup = () => {
      self.clearTimeout(timeout);
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("error", onError);
    };
    channel.addEventListener("open", onOpen);
    channel.addEventListener("error", onError);
  });
}

async function playAgentAudio(agent: ActiveAgent, stream: MediaStream): Promise<void> {
  if (activeAgent !== agent) return;
  agent.outputAudio.srcObject = stream;
  try {
    await agent.outputAudio.play();
  } catch {
    void publishAgent({
      ...agentSnapshot,
      detail: "Counterpoint connected, but Chrome blocked local audio playback. Interactions remain visible in the sidebar.",
    });
  }
}

async function stopAgent(detail: string, announce = true): Promise<void> {
  clearPendingCandidateDraft();
  clearDemoSpeechTimer();
  candidate = undefined;
  evidence = emptyEvidence();
  resetGate();

  const agent = activeAgent;
  activeAgent = undefined;
  activeMode = undefined;
  if (agent) closeAgentResources(agent);

  if (announce) {
    await publishAgent({ status: "stopped", gatePhase: "idle", detail });
  }
}

function closeAgentResources(agent: ActiveAgent): void {
  agent.outputAudio.pause();
  agent.outputAudio.srcObject = null;
  agent.channel.close();
  agent.peer.close();
}

async function stopCapture(detail: string, announce = true): Promise<void> {
  const hadActiveAgent = Boolean(activeAgent) || activeMode === "demo";
  await stopAgent("Tab capture ended.", hadActiveAgent);
  const capture = activeCapture;
  pendingSpeech = undefined;
  activeCapture = undefined;
  if (capture) {
    self.clearInterval(capture.timer);
    capture.stream.getTracks().forEach((track) => track.stop());
    await capture.context.close();
  }
  if (announce) {
    await publishCapture({ ...INITIAL_CAPTURE_SNAPSHOT, status: "stopped", detail });
  }
}

function resetGate(): void {
  gateState = createGateState(performance.now());
}

function clearDemoSpeechTimer(): void {
  if (demoSpeechTimer === undefined) return;
  self.clearTimeout(demoSpeechTimer);
  demoSpeechTimer = undefined;
}

function emptyEvidence(detail = INITIAL_EVIDENCE_SNAPSHOT.detail): EvidenceSnapshot {
  return { status: "idle", detail, sources: [] };
}

function normalizeDraft(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 700) return undefined;
  return normalized;
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

function readEvidenceSources(value: unknown): EvidenceSource[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((source): EvidenceSource[] => {
    if (!isRecord(source) || typeof source.title !== "string" || typeof source.url !== "string") {
      return [];
    }
    return [
      {
        title: source.title,
        url: source.url,
        publishedAt: typeof source.publishedAt === "string" ? source.publishedAt : undefined,
        highlight: typeof source.highlight === "string" ? source.highlight : undefined,
      },
    ];
  });
}

function rms(samples: Uint8Array): number {
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

async function publishCapture(snapshot: CaptureSnapshot): Promise<void> {
  await chrome.runtime.sendMessage({ type: "capture_snapshot", snapshot, source: "offscreen" });
}

async function publishAgent(snapshot: AgentSnapshot): Promise<void> {
  agentSnapshot = { ...snapshot, mode: activeMode, evidence };
  await chrome.runtime.sendMessage({ type: "agent_snapshot", snapshot: agentSnapshot, source: "offscreen" });
}
