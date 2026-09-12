export type CaptureStatus = "idle" | "connecting" | "capturing" | "stopped" | "error";

export interface CaptureSnapshot {
  status: CaptureStatus;
  tabId?: number;
  tabTitle?: string;
  level: number;
  speech: boolean;
  detail: string;
}

export type AgentStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "drafting"
  | "holding"
  | "ready"
  | "speaking"
  | "stopped"
  | "error";

export type AgentMode = "live" | "demo";

export type EvidenceStatus = "idle" | "loading" | "ready" | "error";

export interface EvidenceSource {
  title: string;
  url: string;
  publishedAt?: string;
  highlight?: string;
}

export interface EvidenceSnapshot {
  status: EvidenceStatus;
  detail: string;
  sources: EvidenceSource[];
}

export interface AgentSnapshot {
  status: AgentStatus;
  gatePhase: "idle" | "listening" | "holding" | "opening" | "speaking";
  detail: string;
  mode?: AgentMode;
  intervention?: string;
  transcript?: string;
  evidence?: EvidenceSnapshot;
}

export const INITIAL_EVIDENCE_SNAPSHOT: EvidenceSnapshot = {
  status: "idle",
  detail: "Research is available when Counterpoint has a suggestion ready for review.",
  sources: [],
};

export const INITIAL_CAPTURE_SNAPSHOT: CaptureSnapshot = {
  status: "idle",
  level: 0,
  speech: false,
  detail: "Open a Google Meet tab and click the extension icon.",
};

export const INITIAL_AGENT_SNAPSHOT: AgentSnapshot = {
  status: "idle",
  gatePhase: "idle",
  detail: "Start capture first. Then explicitly start the voice cofacilitator.",
  evidence: INITIAL_EVIDENCE_SNAPSHOT,
};

export type ExtensionMessage =
  | {
      type: "capture_tab_audio";
      streamId: string;
      tabId: number;
      tabTitle: string;
      source: "background";
    }
  | { type: "capture_snapshot"; snapshot: CaptureSnapshot; source: "background" | "offscreen" }
  | { type: "get_capture_snapshot" }
  | { type: "stop_capture"; source: "background" | "sidepanel" }
  | { type: "start_agent"; source: "background" | "sidepanel" }
  | { type: "stop_agent"; source: "background" | "sidepanel" }
  | { type: "speak_candidate"; source: "background" | "sidepanel" }
  | { type: "discard_candidate"; source: "background" | "sidepanel" }
  | { type: "research_candidate"; source: "background" | "sidepanel" }
  | { type: "run_demo"; source: "background" | "sidepanel" }
  | { type: "agent_snapshot"; snapshot: AgentSnapshot; source: "background" | "offscreen" }
  | { type: "get_agent_snapshot" };
