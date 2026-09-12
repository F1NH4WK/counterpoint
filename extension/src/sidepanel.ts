import {
  INITIAL_AGENT_SNAPSHOT,
  INITIAL_CAPTURE_SNAPSHOT,
  type AgentSnapshot,
  type CaptureSnapshot,
  type ExtensionMessage,
} from "./protocol.js";

const captureStatus = requiredElement("capture-status");
const level = requiredElement("level");
const activity = requiredElement("activity");
const captureDetail = requiredElement("capture-detail");
const agentStatus = requiredElement("agent-status");
const agentMode = requiredElement("agent-mode");
const gate = requiredElement("gate");
const agentDetail = requiredElement("agent-detail");
const intervention = requiredElement("intervention");
const transcript = requiredElement("transcript");
const evidenceStatus = requiredElement("evidence-status");
const evidenceDetail = requiredElement("evidence-detail");
const evidenceSources = requiredElement<HTMLUListElement>("evidence-sources");
const startAgentButton = requiredElement<HTMLButtonElement>("start-agent");
const stopAgentButton = requiredElement<HTMLButtonElement>("stop-agent");
const speakCandidateButton = requiredElement<HTMLButtonElement>("speak-candidate");
const researchCandidateButton = requiredElement<HTMLButtonElement>("research-candidate");
const discardCandidateButton = requiredElement<HTMLButtonElement>("discard-candidate");
const runDemoButton = requiredElement<HTMLButtonElement>("run-demo");
const stopCaptureButton = requiredElement<HTMLButtonElement>("stop-capture");

let captureSnapshot = INITIAL_CAPTURE_SNAPSHOT;
let agentSnapshot = INITIAL_AGENT_SNAPSHOT;

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "capture_snapshot") {
    captureSnapshot = message.snapshot;
    render();
  }
  if (message.type === "agent_snapshot") {
    agentSnapshot = message.snapshot;
    render();
  }
});

startAgentButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "start_agent", source: "sidepanel" });
});

stopAgentButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "stop_agent", source: "sidepanel" });
});

speakCandidateButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "speak_candidate", source: "sidepanel" });
});

researchCandidateButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "research_candidate", source: "sidepanel" });
});

discardCandidateButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "discard_candidate", source: "sidepanel" });
});

runDemoButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "run_demo", source: "sidepanel" });
});

stopCaptureButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "stop_capture", source: "sidepanel" });
});

void loadInitialSnapshots();

async function loadInitialSnapshots(): Promise<void> {
  try {
    const [capture, agent] = await Promise.all([
      chrome.runtime.sendMessage({ type: "get_capture_snapshot" }) as Promise<CaptureSnapshot | undefined>,
      chrome.runtime.sendMessage({ type: "get_agent_snapshot" }) as Promise<AgentSnapshot | undefined>,
    ]);
    captureSnapshot = capture ?? INITIAL_CAPTURE_SNAPSHOT;
    agentSnapshot = agent ?? INITIAL_AGENT_SNAPSHOT;
  } catch {
    captureSnapshot = INITIAL_CAPTURE_SNAPSHOT;
    agentSnapshot = INITIAL_AGENT_SNAPSHOT;
  }
  render();
}

function render(): void {
  captureStatus.textContent = titleCase(captureSnapshot.status);
  captureStatus.dataset.state = captureSnapshot.status;
  level.textContent = captureSnapshot.level.toFixed(3);
  activity.textContent = captureSnapshot.status === "capturing" ? (captureSnapshot.speech ? "Speech" : "Silence") : "—";
  activity.dataset.activity = captureSnapshot.speech ? "speech" : "silence";
  captureDetail.textContent = captureSnapshot.detail;

  agentStatus.textContent = titleCase(agentSnapshot.status);
  agentStatus.dataset.state = agentSnapshot.status;
  agentMode.textContent = agentSnapshot.mode ? titleCase(agentSnapshot.mode) : "—";
  gate.textContent = titleCase(agentSnapshot.gatePhase);
  agentDetail.textContent = agentSnapshot.detail;
  intervention.textContent = agentSnapshot.intervention ?? "—";
  transcript.textContent = agentSnapshot.transcript ?? "—";

  const evidence = agentSnapshot.evidence;
  evidenceStatus.textContent = titleCase(evidence?.status ?? "idle");
  evidenceStatus.dataset.state = evidence?.status ?? "idle";
  evidenceDetail.textContent = evidence?.detail ?? "Research is not available yet.";
  renderEvidenceSources(evidence?.sources ?? []);

  const agentActive = ["connecting", "listening", "drafting", "holding", "ready", "speaking"].includes(agentSnapshot.status);
  const candidateReady = agentSnapshot.status === "ready" && Boolean(agentSnapshot.intervention);
  const liveAgentBusy = agentSnapshot.mode === "live" && agentActive;
  startAgentButton.disabled = captureSnapshot.status !== "capturing" || agentActive;
  stopAgentButton.disabled = !agentActive;
  speakCandidateButton.disabled = !candidateReady;
  researchCandidateButton.disabled = !candidateReady;
  discardCandidateButton.disabled = !candidateReady;
  runDemoButton.disabled = liveAgentBusy;
  stopCaptureButton.disabled = captureSnapshot.status !== "capturing" && captureSnapshot.status !== "connecting";
}

function renderEvidenceSources(sources: NonNullable<AgentSnapshot["evidence"]>["sources"]): void {
  evidenceSources.replaceChildren();
  if (sources.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "—";
    evidenceSources.append(empty);
    return;
  }

  for (const source of sources) {
    const item = document.createElement("li");
    const url = safeExternalUrl(source.url);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = source.title;
      item.append(link);
    } else {
      item.textContent = source.title;
    }

    const metadata = [source.publishedAt, source.highlight].filter(Boolean).join(" · ");
    if (metadata) {
      const detail = document.createElement("p");
      detail.textContent = metadata;
      item.append(detail);
    }
    evidenceSources.append(item);
  }
}

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}.`);
  return element as T;
}
