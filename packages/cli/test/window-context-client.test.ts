import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isValidIpcEndpoint,
  queryWindowContext
} from "../src/window-context-client.js";

describe("window context IPC client", () => {
  it("uses a real Unix socket and validates the HTTP response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attentive-ipc-"));
    const socketPath = join(directory, "context.sock");
    let requestMethod = "";
    let requestPath = "";
    let connectionHeader: string | string[] | undefined;
    const server = createServer((request, response) => {
      requestMethod = request.method ?? "";
      requestPath = request.url ?? "";
      connectionHeader = request.headers.connection;
      response.setHeader("content-type", "application/json");
      response.setHeader("connection", "close");
      response.end(JSON.stringify({
        version: 1,
        focused: false,
        callbackUri: "vscode://attentive.attentive-vscode/focus?window=one"
      }));
    });

    try {
      await listen(server, socketPath);
      assert.deepEqual(await queryWindowContext(socketPath), {
        kind: "available",
        context: {
          version: 1,
          focused: false,
          callbackUri: "vscode://attentive.attentive-vscode/focus?window=one"
        }
      });
      assert.equal(requestMethod, "GET");
      assert.equal(requestPath, "/v1/window-context");
      assert.equal(connectionHeader, "close");
    } finally {
      await closeServer(server);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails open for a missing endpoint and oversized response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attentive-ipc-"));
    const missingSocket = join(directory, "missing.sock");
    const oversizedSocket = join(directory, "oversized.sock");
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        version: 1,
        focused: false,
        callbackUri: `https://example.com/${"a".repeat(9000)}`
      }));
    });

    try {
      assert.deepEqual(await queryWindowContext(missingSocket), {
        kind: "unavailable"
      });
      await listen(server, oversizedSocket);
      assert.deepEqual(await queryWindowContext(oversizedSocket), {
        kind: "unavailable"
      });
    } finally {
      await closeServer(server);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails open for invalid status, content, JSON, and core fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attentive-ipc-"));
    const socketPath = join(directory, "invalid.sock");
    const responses: Array<{
      status: number;
      contentType?: string;
      body: string;
    }> = [
      { status: 500, contentType: "application/json", body: "{}" },
      { status: 200, contentType: "text/plain", body: "{}" },
      { status: 200, contentType: "application/json", body: "not json" },
      {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 2, focused: false })
      },
      {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 1, focused: "false" })
      }
    ];
    const server = createServer((_request, response) => {
      const next = responses.shift() ?? {
        status: 500,
        contentType: "application/json",
        body: "{}"
      };
      response.statusCode = next.status;
      if (next.contentType) {
        response.setHeader("content-type", next.contentType);
      }
      response.setHeader("connection", "close");
      response.end(next.body);
    });

    try {
      await listen(server, socketPath);
      for (let index = 0; index < 5; index += 1) {
        assert.deepEqual(await queryWindowContext(socketPath), {
          kind: "unavailable"
        });
      }
    } finally {
      await closeServer(server);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects endpoint values that cannot be used on the current platform", () => {
    assert.equal(isValidIpcEndpoint("", "linux"), false);
    assert.equal(isValidIpcEndpoint("relative.sock", "linux"), false);
    assert.equal(isValidIpcEndpoint("/tmp/context.sock", "linux"), true);
    assert.equal(isValidIpcEndpoint("\\\\.\\pipe\\attentive-vscode-id-sock", "win32"), true);
    assert.equal(isValidIpcEndpoint("\\\\.\\pipe\\", "win32"), false);
    assert.equal(isValidIpcEndpoint("/tmp/context.sock", "win32"), false);
  });

  it("cleans request and response listeners after a successful query", async () => {
    const request = new EventEmitter() as EventEmitter & {
      closed: boolean;
      destroyed: boolean;
      end(): void;
      destroy(): void;
    };
    request.closed = false;
    request.destroyed = false;
    request.end = () => undefined;
    request.destroy = () => {
      request.destroyed = true;
      request.closed = true;
      request.emit("close");
    };

    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
      readableEnded: boolean;
      closed: boolean;
      destroyed: boolean;
      destroy(): void;
    };
    response.statusCode = 200;
    response.headers = { "content-type": "application/json" };
    response.readableEnded = false;
    response.closed = false;
    response.destroyed = false;
    response.destroy = () => {
      response.destroyed = true;
      response.closed = true;
      response.emit("close");
    };

    const resultPromise = queryWindowContext("/tmp/context.sock", {
      requestImpl: (_options, callback) => {
        queueMicrotask(() => {
          callback(response as never);
          response.emit("data", JSON.stringify({ version: 1, focused: false }));
          response.readableEnded = true;
          response.emit("end");
          response.closed = true;
          response.emit("close");
          request.closed = true;
          request.emit("close");
        });
        return request as never;
      }
    });

    assert.deepEqual(await resultPromise, {
      kind: "available",
      context: { version: 1, focused: false }
    });
    assert.equal(request.listenerCount("error"), 0);
    assert.equal(request.listenerCount("timeout"), 0);
    assert.equal(response.listenerCount("data"), 0);
    assert.equal(response.listenerCount("aborted"), 0);
    assert.equal(response.listenerCount("error"), 0);
    assert.equal(response.listenerCount("end"), 0);
    assert.equal(response.listenerCount("close"), 0);
  });
});

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
    server.listen(path);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
