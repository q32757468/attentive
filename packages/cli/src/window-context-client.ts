import {
  MAX_WINDOW_CONTEXT_RESPONSE_BYTES,
  WINDOW_CONTEXT_PATH,
  WINDOW_CONTEXT_TIMEOUT_MS,
  parseWindowContextResponse,
  type WindowContextResponse
} from "@attentive-kit/protocol";
import {
  request as defaultRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions
} from "node:http";
import { posix as posixPath } from "node:path";

export const MAX_IPC_ENDPOINT_LENGTH = 256;
export const MAX_UNIX_IPC_ENDPOINT_LENGTH = 100;

export type WindowContextQueryResult =
  | { kind: "available"; context: WindowContextResponse }
  | { kind: "unavailable" }
  | { kind: "invalid-endpoint" };

export type HttpRequestImpl = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

export interface WindowContextClientOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  requestImpl?: HttpRequestImpl;
}

export function isValidIpcEndpoint(
  value: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_IPC_ENDPOINT_LENGTH
  ) {
    return false;
  }

  if (platform === "win32") {
    const pipePrefix = "\\\\.\\pipe\\";
    return value.startsWith(pipePrefix) && value.length > pipePrefix.length;
  }
  return posixPath.isAbsolute(value) &&
    Buffer.byteLength(value, "utf8") <= MAX_UNIX_IPC_ENDPOINT_LENGTH;
}

export function queryWindowContext(
  endpoint: string,
  options: WindowContextClientOptions = {}
): Promise<WindowContextQueryResult> {
  const platform = options.platform ?? process.platform;
  if (!isValidIpcEndpoint(endpoint, platform)) {
    return Promise.resolve({ kind: "invalid-endpoint" });
  }

  const requestImpl = options.requestImpl ?? defaultRequest;
  const timeoutMs = options.timeoutMs ?? WINDOW_CONTEXT_TIMEOUT_MS;

  return new Promise<WindowContextQueryResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let request: ClientRequest | undefined;
    const cleanups: Array<() => void> = [];

    const registerCleanup = (cleanup: () => void): void => {
      if (settled) {
        cleanup();
      } else {
        cleanups.push(cleanup);
      }
    };

    const finish = (result: WindowContextQueryResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
      resolve(result);
    };

    const fail = (): void => finish({ kind: "unavailable" });
    timer = setTimeout(() => {
      request?.destroy();
      fail();
    }, timeoutMs);

    try {
      request = requestImpl(
        {
          socketPath: endpoint,
          method: "GET",
          path: WINDOW_CONTEXT_PATH,
          headers: { connection: "close" },
          agent: false
        },
        (response) => handleResponse(response, finish, fail, registerCleanup)
      );
      const onRequestError = (): void => fail();
      const onRequestTimeout = (): void => {
        request?.destroy();
        fail();
      };
      request.once("error", onRequestError);
      request.once("timeout", onRequestTimeout);
      const activeRequest = request;
      registerCleanup(() => {
        activeRequest.removeListener("timeout", onRequestTimeout);
        if (activeRequest.closed) {
          activeRequest.removeListener("error", onRequestError);
        } else {
          activeRequest.once("close", () => activeRequest.removeListener("error", onRequestError));
        }
      });
      request.end();
    } catch {
      fail();
    }
  });
}

function handleResponse(
  response: IncomingMessage,
  finish: (result: WindowContextQueryResult) => void,
  fail: () => void,
  registerCleanup: (cleanup: () => void) => void
): void {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let tooLarge = false;

  const onData = (chunk: Buffer | string): void => {
    if (tooLarge) {
      return;
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_WINDOW_CONTEXT_RESPONSE_BYTES) {
      tooLarge = true;
      response.destroy();
      fail();
      return;
    }
    chunks.push(buffer);
  };
  const onAborted = (): void => fail();
  const onError = (): void => fail();
  const onEnd = (): void => {
    if (tooLarge) {
      return;
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      const context = parseWindowContextResponse(value);
      if (!context) {
        fail();
        return;
      }
      finish({ kind: "available", context });
    } catch {
      fail();
    }
  };
  const onClose = (): void => {
    response.removeListener("data", onData);
    response.removeListener("aborted", onAborted);
    response.removeListener("error", onError);
    response.removeListener("end", onEnd);
    response.removeListener("close", onClose);
  };

  response.on("data", onData);
  response.once("aborted", onAborted);
  response.once("error", onError);
  response.once("end", onEnd);
  response.once("close", onClose);
  registerCleanup(() => {
    response.removeListener("data", onData);
    response.removeListener("aborted", onAborted);
    response.removeListener("end", onEnd);
    if (response.readableEnded || response.closed) {
      onClose();
    }
  });

  if (response.statusCode !== 200 || !isJsonContentType(response.headers["content-type"])) {
    response.destroy();
    fail();
    return;
  }
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return /^application\/json(?:\s*;|$)/i.test(value);
}
