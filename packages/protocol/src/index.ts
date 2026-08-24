export const API_VERSION = "v1";
export const NOTIFICATIONS_PATH = "/api/v1/notifications";
export const HEALTH_PATH = "/health";

export const DEFAULT_NOTIFIER_HOST = "0.0.0.0";
export const DEFAULT_NOTIFIER_PORT = 8765;
export const DEFAULT_NOTIFIER_URL = "http://127.0.0.1:8765";

export type JsonObject = Record<string, unknown>;

export interface NotificationRequest {
  title: string;
  body: string;
  source?: string;
  url?: string;
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

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
    const url = requireString(value.url, "url");
    if (!isHttpUrl(url)) {
      throw new InvalidNotificationRequestError(
        "url must use the http or https protocol"
      );
    }
    request.url = url;
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
