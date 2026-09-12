import {
  INITIAL_AGENT_SNAPSHOT,
  INITIAL_CAPTURE_SNAPSHOT,
  type AgentSnapshot,
  type CaptureSnapshot,
  type ExtensionMessage,
} from "./protocol.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreen: Promise<void> | undefined;
let snapshot: CaptureSnapshot = INITIAL_CAPTURE_SNAPSHOT;
let agentSnapshot: AgentSnapshot = INITIAL_AGENT_SNAPSHOT;

chrome.action.onClicked.addListener((tab) => {
  void beginCapture(tab);
});

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender,
    sendResponse: (response?: CaptureSnapshot | AgentSnapshot) => void,
  ) => {
    if (message.type === "capture_snapshot" && message.source === "offscreen") {
      snapshot = message.snapshot;
      void chrome.runtime.sendMessage({ type: "capture_snapshot", snapshot, source: "background" });
      return;
    }

    if (message.type === "get_capture_snapshot") {
      sendResponse(snapshot);
      return;
    }

    if (message.type === "agent_snapshot" && message.source === "offscreen") {
      agentSnapshot = message.snapshot;
      void chrome.runtime.sendMessage({ type: "agent_snapshot", snapshot: agentSnapshot, source: "background" });
      return;
    }

    if (message.type === "get_agent_snapshot") {
      sendResponse(agentSnapshot);
      return;
    }

    if (message.type === "stop_capture" && message.source === "sidepanel") {
      void chrome.runtime.sendMessage({ type: "stop_agent", source: "background" });
      void chrome.runtime.sendMessage({ type: "stop_capture", source: "background" });
    }

    if (message.type === "start_agent" && message.source === "sidepanel") {
      void ensureOffscreenDocument().then(() =>
        chrome.runtime.sendMessage({ type: "start_agent", source: "background" }),
      );
    }

    if (message.type === "stop_agent" && message.source === "sidepanel") {
      void chrome.runtime.sendMessage({ type: "stop_agent", source: "background" });
    }

    if (
      (message.type === "speak_candidate" ||
        message.type === "discard_candidate" ||
        message.type === "research_candidate") &&
      message.source === "sidepanel"
    ) {
      void chrome.runtime.sendMessage({ type: message.type, source: "background" });
    }

    if (message.type === "run_demo" && message.source === "sidepanel") {
      void ensureOffscreenDocument().then(() =>
        chrome.runtime.sendMessage({ type: "run_demo", source: "background" }),
      );
    }
  },
);

async function beginCapture(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.windowId) return;

  if (!tab.url?.startsWith("https://meet.google.com/")) {
    await publish({
      ...INITIAL_CAPTURE_SNAPSHOT,
      status: "error",
      detail: "Open a Google Meet tab before starting the Counterpoint spike.",
    });
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return;
  }

  await chrome.sidePanel.open({ windowId: tab.windowId });
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ type: "stop_agent", source: "background" });
  await publish({
    status: "connecting",
    tabId: tab.id,
    tabTitle: tab.title ?? "Google Meet",
    level: 0,
    speech: false,
    detail: "Requesting local tab-audio capture…",
  });

  try {
    const streamId = await getTabAudioStreamId(tab.id);
    await chrome.runtime.sendMessage({
      type: "capture_tab_audio",
      streamId,
      tabId: tab.id,
      tabTitle: tab.title ?? "Google Meet",
      source: "background",
    });
  } catch (cause) {
    await publish({
      ...snapshot,
      status: "error",
      detail: cause instanceof Error ? cause.message : "Chrome could not capture this tab.",
    });
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
        justification: "Capture Meet tab audio locally and preserve local audio playback.",
      })
      .finally(() => {
        creatingOffscreen = undefined;
      });
  }
  await creatingOffscreen;
}

function getTabAudioStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
      } else if (!streamId) {
        reject(new Error("Chrome did not return a tab-audio stream id."));
      } else {
        resolve(streamId);
      }
    });
  });
}

async function publish(next: CaptureSnapshot): Promise<void> {
  snapshot = next;
  await chrome.runtime.sendMessage({ type: "capture_snapshot", snapshot: next, source: "background" });
}
