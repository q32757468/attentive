import { randomUUID } from "node:crypto";
import {
  createApiError,
  DEFAULT_NOTIFIER_HOST,
  DEFAULT_NOTIFIER_PORT,
  ERROR_CODES,
  HEALTH_PATH,
  InvalidNotificationRequestError,
  NOTIFICATIONS_PATH,
  type CreateNotificationResponse,
  type NotificationRequest,
  validateNotificationRequest
} from "@attentive-kit/protocol";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createWindowsToastDispatcher, type NotificationDispatcher } from "./toast.js";

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface NotifierLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface NotifierServerOptions {
  dispatcher?: NotificationDispatcher;
  logger?: NotifierLogger;
  maxBodyBytes?: number;
}

export interface StartNotifierOptions extends NotifierServerOptions {
  host?: string;
  port?: number;
}

const defaultLogger: NotifierLogger = {
  info(message, context) {
    console.info(message, context ?? "");
  },
  error(message, context) {
    console.error(message, context ?? "");
  }
};

export function createNotifierServer(
  options: NotifierServerOptions = {}
): Server {
  const dispatcher = options.dispatcher ?? createWindowsToastDispatcher();
  const logger = options.logger ?? defaultLogger;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return createServer((request, response) => {
    void handleRequest(request, response, {
      dispatcher,
      logger,
      maxBodyBytes
    }).catch((error: unknown) => {
      logger.error("Unhandled notifier request error", {
        error: error instanceof Error ? error.message : String(error)
      });
      if (!response.headersSent) {
        sendJson(response, 500, createApiError(ERROR_CODES.INTERNAL_ERROR, "internal server error"));
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });
}

export async function startNotifier(
  options: StartNotifierOptions = {}
): Promise<Server> {
  const {
    host = DEFAULT_NOTIFIER_HOST,
    port = DEFAULT_NOTIFIER_PORT,
    ...serverOptions
  } = options;
  const server = createNotifierServer(serverOptions);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  return server;
}

interface RequestContext {
  dispatcher: NotificationDispatcher;
  logger: NotifierLogger;
  maxBodyBytes: number;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://notifier.local");

  if (requestUrl.pathname === HEALTH_PATH) {
    if (request.method !== "GET") {
      sendMethodNotAllowed(response);
      return;
    }
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (requestUrl.pathname !== NOTIFICATIONS_PATH) {
    sendJson(response, 404, createApiError(ERROR_CODES.NOT_FOUND, "route not found"));
    return;
  }

  if (request.method !== "POST") {
    sendMethodNotAllowed(response);
    return;
  }

  let notificationRequest: NotificationRequest;
  try {
    const body = await readJsonBody(request, context.maxBodyBytes);
    notificationRequest = validateBody(body);
  } catch (error: unknown) {
    if (error instanceof InvalidNotificationRequestError || error instanceof RequestBodyError) {
      const statusCode = error instanceof RequestBodyError ? error.statusCode : 400;
      sendJson(response, statusCode, createApiError(ERROR_CODES.INVALID_REQUEST, error.message));
      return;
    }
    throw error;
  }

  const notificationId = randomUUID();
  try {
    await context.dispatcher(notificationRequest, notificationId);
  } catch (error: unknown) {
    context.logger.error("Unable to submit notification", {
      ...createNotificationLogContext(notificationId, notificationRequest.source),
      error: error instanceof Error ? error.message : String(error)
    });
    sendJson(response, 500, createApiError(ERROR_CODES.INTERNAL_ERROR, "unable to submit notification"));
    return;
  }

  context.logger.info("Notification submitted", {
    ...createNotificationLogContext(notificationId, notificationRequest.source)
  });
  const result: CreateNotificationResponse = { notificationId };
  sendJson(response, 201, result);
}

function createNotificationLogContext(
  notificationId: string,
  source: string | undefined
): Record<string, unknown> {
  return {
    notificationId,
    ...(source === undefined ? {} : { source })
  };
}

function validateBody(value: unknown): NotificationRequest {
  // Kept as a small wrapper so the HTTP layer has a single protocol boundary.
  // The import is intentionally local to make this function easy to exercise in isolation.
  return validateNotificationRequest(value);
}

function sendMethodNotAllowed(response: ServerResponse): void {
  sendJson(
    response,
    405,
    createApiError(ERROR_CODES.METHOD_NOT_ALLOWED, "method not allowed")
  );
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > maxBodyBytes) {
      throw new RequestBodyError("request body is too large", 413);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new RequestBodyError("request body must be valid JSON", 400);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestBodyError("request body must be valid JSON", 400);
  }
}

class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}
