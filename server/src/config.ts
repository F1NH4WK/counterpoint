export interface CounterpointConfig {
  host: string;
  port: number;
  openAiApiKey?: string;
  realtimeModel: string;
  realtimeVoice: string;
  allowedOrigins: readonly string[];
  allowAnyChromeExtension: boolean;
  demoToken?: string;
}

const DEFAULT_PORT = 8787;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): CounterpointConfig {
  return {
    host: environment.COUNTERPOINT_HOST?.trim() || "127.0.0.1",
    port: readPort(environment.COUNTERPOINT_PORT),
    openAiApiKey: nonEmpty(environment.OPENAI_API_KEY),
    realtimeModel: environment.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime",
    realtimeVoice: environment.OPENAI_REALTIME_VOICE?.trim() || "alloy",
    allowedOrigins: splitOrigins(environment.COUNTERPOINT_ALLOWED_ORIGINS),
    allowAnyChromeExtension: environment.COUNTERPOINT_ALLOW_ANY_CHROME_EXTENSION === "true",
    demoToken: nonEmpty(environment.COUNTERPOINT_DEMO_TOKEN),
  };
}

function readPort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("COUNTERPOINT_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function splitOrigins(value: string | undefined): readonly string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
