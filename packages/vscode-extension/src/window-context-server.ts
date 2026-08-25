import { chmod } from "node:fs/promises";
import {
  MAX_WINDOW_CONTEXT_RESPONSE_BYTES,
  WINDOW_CONTEXT_PATH,
  WINDOW_CONTEXT_VERSION,
  parseWindowContextResponse,
  type WindowContextResponse
} from "@attentive/protocol";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse
} from "node:http";
import type { Socket } from "node:net";
import {
  cleanupIpcEndpoint,
  createIpcEndpoint,
  defaultIpcEndpointFileSystem,
  type IpcEndpoint,
  type IpcEndpointFileSystem,
  type IpcEndpointOptions
} from "./ipc-endpoint.js";

const MAX_HEADER_BYTES = 8 * 1024;
const DEFAULT_MAX_CONNECTIONS = 32;
const DEFAULT_IDLE_TIMEOUT_MS = 250;

export interface WindowContextServerLogger {
  error(message: string, context?: Record<string, unknown>): void;
}

export interface WindowContextServerOptions {
  getContext: () => WindowContextResponse;
  endpoint?: IpcEndpoint;
  endpointOptions?: IpcEndpointOptions;
  platform?: NodeJS.Platform;
  chmodImpl?: typeof chmod;
  logger?: WindowContextServerLogger;
  onError?: (category: string) => void;
  maxConnections?: number;
  idleTimeoutMs?: number;
  createServerImpl?: (
    options: { maxHeaderSize: number },
    requestListener: RequestListener
  ) => Server;
}

export interface WindowContextServer {
  readonly endpoint: IpcEndpoint;
  readonly isListening: boolean;
  dispose(): Promise<void>;
}

const defaultLogger: WindowContextServerLogger = {
  error(message, context) {
    console.error(message, context ?? "");
  }
};

export async function startWindowContextServer(
  options: WindowContextServerOptions
): Promise<WindowContextServer> {
  const endpointOptions = options.platform === undefined
    ? options.endpointOptions
    : { ...options.endpointOptions, platform: options.platform };
  const endpoint = options.endpoint ?? await createIpcEndpoint(endpointOptions);
  const endpointFileSystem: IpcEndpointFileSystem =
    endpointOptions?.fileSystem ?? defaultIpcEndpointFileSystem;
  const logger = options.logger ?? defaultLogger;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const connections = new Set<Socket>();
  let stopping = false;
  let listening = false;

  const reportError = (category: string): void => {
    options.onError?.(category);
    logger.error("Window context IPC error", { category });
  };

  const serverFactory = options.createServerImpl ?? createServer;
  let server: Server;
  try {
    server = serverFactory(
      { maxHeaderSize: MAX_HEADER_BYTES },
      (request, response) => {
        void handleRequest(request, response, options.getContext, reportError).catch(() => {
          reportError("handler-error");
          if (!response.headersSent) {
            sendJson(response, 500, { error: "internal server error" });
          } else if (!response.writableEnded) {
            response.end();
          }
        });
      }
    );
  } catch (error: unknown) {
    await cleanupIpcEndpoint(endpoint, endpointFileSystem, { removeSocket: false });
    throw error;
  }

  try {
    server.headersTimeout = idleTimeoutMs;
    server.requestTimeout = idleTimeoutMs;
    server.keepAliveTimeout = 1;
    server.maxConnections = maxConnections;

    server.on("connection", (socket: Socket) => {
      if (connections.size >= maxConnections) {
        reportError("connection-limit");
        socket.destroy();
        return;
      }
      connections.add(socket);
      socket.setTimeout(idleTimeoutMs, () => socket.destroy());
      socket.once("close", () => connections.delete(socket));
    });
    server.on("clientError", (_error, socket) => {
      reportError("client-error");
      if (!socket.destroyed) {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      }
    });
    server.on("error", () => reportError("server-error"));

    await listen(server, endpoint.value);
    listening = true;
    if (endpoint.kind === "socket") {
      await (options.chmodImpl ?? endpointFileSystem.chmod ?? chmod)(endpoint.value, 0o600);
    }
  } catch (error: unknown) {
    stopping = true;
    for (const socket of connections) {
      socket.destroy();
    }
    try {
      await closeServer(server);
    } catch {
      // Preserve the startup error; cleanup below remains best effort.
    }
    await cleanupIpcEndpoint(endpoint, endpointFileSystem, { removeSocket: listening });
    throw error;
  }

  return {
    endpoint,
    get isListening() {
      return server.listening && !stopping;
    },
    async dispose(): Promise<void> {
      if (stopping) {
        return;
      }
      stopping = true;
      for (const socket of connections) {
        socket.destroy();
      }
      try {
        await closeServer(server);
      } finally {
        await cleanupIpcEndpoint(endpoint, endpointFileSystem);
      }
    }
  };
}


async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  getContext: () => WindowContextResponse,
  reportError: (category: string) => void
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://attentive.local");
  response.setHeader("connection", "close");

  if (requestUrl.pathname !== WINDOW_CONTEXT_PATH) {
    sendJson(response, 404, { error: "route not found" });
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  const context = parseWindowContextResponse({
    ...getContext(),
    version: WINDOW_CONTEXT_VERSION
  });
  if (!context) {
    reportError("invalid-context");
    sendJson(response, 500, { error: "internal server error" });
    return;
  }
  sendJson(response, 200, context);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_WINDOW_CONTEXT_RESPONSE_BYTES) {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.setHeader("connection", "close");
    response.end(JSON.stringify({ error: "response too large" }));
    return;
  }

  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("content-length", Buffer.byteLength(body, "utf8"));
  response.setHeader("connection", "close");
  response.end(body);
}

async function listen(server: Server, endpoint: string): Promise<void> {
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
    server.listen(endpoint);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
