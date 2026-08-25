import {
  MAX_OPEN_URI_LENGTH,
  isHttpUrl,
  isOpenUri
} from "./uri.js";

export const API_VERSION = "v1";
export const NOTIFICATIONS_PATH = "/api/v1/notifications";
export const HEALTH_PATH = "/health";

export const DEFAULT_NOTIFIER_HOST = "0.0.0.0";
export const DEFAULT_NOTIFIER_PORT = 8765;
export const DEFAULT_NOTIFIER_URL = "http://127.0.0.1:8765";

export {
  isHttpUrl,
  isOpenUri,
  MAX_OPEN_URI_LENGTH,
  OPEN_URI_SCHEMES
} from "./uri.js";

export type JsonObject = Record<string, unknown>;

export interface OpenUriAction {
  type: "open-uri";
  uri: string;
}

export interface NotificationRequest {
  title: string;
  body: string;
  source?: string;
  action?: OpenUriAction;
  metadata?: JsonObject;
}

export interface CreateNotificationResponse {
  notificationId: string;
}

export const ERROR_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export class InvalidNotificationRequestError extends Error {
  readonly code = ERROR_CODES.INVALID_REQUEST;

  constructor(message: string) {
    super(message);
    this.name = "InvalidNotificationRequestError";
  }
}

export function createApiError(
  code: ErrorCode,
  message: string
): ApiErrorResponse {
  return { error: { code, message } };
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateNotificationRequest(
  value: unknown
): NotificationRequest {
  if (!isJsonObject(value)) {
    throw new InvalidNotificationRequestError("request body must be a JSON object");
  }

  const title = requireNonEmptyString(value.title, "title");
  const body = requireNonEmptyString(value.body, "body");
  const request: NotificationRequest = { title, body };

  if (value.source !== undefined) {
    request.source = requireString(value.source, "source");
  }

  if (value.url !== undefined) {
    throw new InvalidNotificationRequestError(
      "url is no longer supported; use action"
    );
  }

  if (value.action !== undefined) {
    if (!isJsonObject(value.action)) {
      throw new InvalidNotificationRequestError("action must be a JSON object");
    }
    if (value.action.type !== "open-uri") {
      throw new InvalidNotificationRequestError(
        'action.type must be "open-uri"'
      );
    }
    const uri = requireString(value.action.uri, "action.uri");
    if (!isOpenUri(uri)) {
      throw new InvalidNotificationRequestError(
        `action.uri must use http, https, or vscode and be at most ${MAX_OPEN_URI_LENGTH} characters`
      );
    }
    request.action = { type: "open-uri", uri };
  }

  if (value.metadata !== undefined) {
    if (!isJsonObject(value.metadata)) {
      throw new InvalidNotificationRequestError(
        "metadata must be a JSON object"
      );
    }
    request.metadata = value.metadata;
  }

  return request;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const result = requireString(value, field);
  if (result.trim().length === 0) {
    throw new InvalidNotificationRequestError(`${field} is required`);
  }
  return result;
}

function requireString(value: unknown, field: string): string {
  if (value === undefined) {
    throw new InvalidNotificationRequestError(`${field} is required`);
  }
  if (typeof value !== "string") {
    throw new InvalidNotificationRequestError(`${field} must be a string`);
  }
  return value;
}

export {
  MAX_WINDOW_CONTEXT_RESPONSE_BYTES,
  WINDOW_CONTEXT_ENDPOINT_ENVIRONMENT_VARIABLE,
  WINDOW_CONTEXT_PATH,
  WINDOW_CONTEXT_TIMEOUT_MS,
  WINDOW_CONTEXT_VERSION,
  parseWindowContextResponse,
  type WindowContextResponse
} from "./window-context.js";
