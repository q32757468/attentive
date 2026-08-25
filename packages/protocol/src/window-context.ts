import { isOpenUri } from "./uri.js";

export const WINDOW_CONTEXT_VERSION = 1 as const;
export const WINDOW_CONTEXT_PATH = "/v1/window-context";
export const WINDOW_CONTEXT_TIMEOUT_MS = 100;
export const MAX_WINDOW_CONTEXT_RESPONSE_BYTES = 8 * 1024;
export const WINDOW_CONTEXT_ENDPOINT_ENVIRONMENT_VARIABLE =
  "ATTENTIVE_VSCODE_IPC_ENDPOINT";

export interface WindowContextResponse {
  version: typeof WINDOW_CONTEXT_VERSION;
  focused: boolean;
  callbackUri?: string;
}

/**
 * Parses the wire response while keeping the required focus state independent
 * from the optional callback URI. An invalid callback is intentionally treated
 * as absent so that focus suppression still works.
 */
export function parseWindowContextResponse(
  value: unknown
): WindowContextResponse | undefined {
  if (!isRecord(value) || value.version !== WINDOW_CONTEXT_VERSION) {
    return undefined;
  }
  if (typeof value.focused !== "boolean") {
    return undefined;
  }

  const response: WindowContextResponse = {
    version: WINDOW_CONTEXT_VERSION,
    focused: value.focused
  };
  if (typeof value.callbackUri === "string" && isOpenUri(value.callbackUri)) {
    response.callbackUri = value.callbackUri;
  }
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
