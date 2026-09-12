/**
 * Local development defaults. The server binds to loopback and validates this
 * extension's origin; no API key or provider secret belongs in this file.
 */
export const COUNTERPOINT_SERVER_URL = "http://127.0.0.1:8787";

// Leave empty unless COUNTERPOINT_DEMO_TOKEN is configured on the local server.
// This is a demo guard, not a replacement for proper user authentication.
export const COUNTERPOINT_DEMO_TOKEN: string | undefined = undefined;
