import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { restoreIpcEndpoint } from "../src/ipc-endpoint.js";
import { startWindowContextServer } from "../src/window-context-server.js";

describe("window context IPC server", () => {
  it("serves live focused state over a Unix socket and disposes cleanly", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attentive-window-"));
    const socketPath = join(directory, "context.sock");
    let focused = false;
    const server = await startWindowContextServer({
      endpoint: { kind: "socket", value: socketPath },
      getContext: () => ({
        version: 1,
        focused,
        callbackUri: "vscode://32757468.attentive-vscode/focus?window=server"
      }),
      logger: { error() {} }
    });

    try {
      assert.equal(server.isListening, true);
      assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
      assert.deepEqual(await requestOverSocket(socketPath, "GET", "/v1/window-context"), {
        status: 200,
        contentType: "application/json",
        body: {
          version: 1,
          focused: false,
          callbackUri: "vscode://32757468.attentive-vscode/focus?window=server"
        }
      });

      focused = true;
      assert.deepEqual(await requestOverSocket(socketPath, "GET", "/v1/window-context"), {
        status: 200,
        contentType: "application/json",
        body: {
          version: 1,
          focused: true,
          callbackUri: "vscode://32757468.attentive-vscode/focus?window=server"
        }
      });
      assert.equal((await requestOverSocket(socketPath, "GET", "/other")).status, 404);
      assert.equal((await requestOverSocket(socketPath, "POST", "/v1/window-context")).status, 405);
    } finally {
      await server.dispose();
      await assert.rejects(() => stat(socketPath));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("drops an invalid optional callback while preserving focus", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attentive-window-"));
    const socketPath = join(directory, "context.sock");
    const server = await startWindowContextServer({
      endpoint: { kind: "socket", value: socketPath },
      getContext: () => ({
        version: 1,
        focused: true,
        callbackUri: "file:///not-allowed"
      }),
      logger: { error() {} }
    });

    try {
      const response = await requestOverSocket(socketPath, "GET", "/v1/window-context");
      assert.deepEqual(response.body, { version: 1, focused: true });
    } finally {
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not unlink another server's socket when listening fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attentive-window-"));
    const socketPath = join(directory, "context.sock");
    const first = await startWindowContextServer({
      endpoint: { kind: "socket", value: socketPath },
      getContext: () => ({ version: 1, focused: false }),
      logger: { error() {} }
    });

    try {
      await assert.rejects(() => startWindowContextServer({
        endpoint: { kind: "socket", value: socketPath },
        getContext: () => ({ version: 1, focused: false }),
        logger: { error() {} }
      }));
      assert.equal((await stat(socketPath)).isSocket(), true);
    } finally {
      await first.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves a generated private directory for endpoint reuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "attentive-preserve-"));
    const endpointOptions = {
      platform: "linux" as const,
      env: {},
      tempDirectory: () => root,
      currentUid: () => process.getuid?.()
    };
    const server = await startWindowContextServer({
      endpointOptions,
      preservePrivateDirectory: true,
      getContext: () => ({ version: 1, focused: false }),
      logger: { error() {} }
    });
    const directory = server.endpoint.privateDirectory;

    try {
      assert.notEqual(directory, undefined);
      await server.dispose();
      await assert.rejects(() => stat(server.endpoint.value));
      assert.equal((await stat(directory ?? "")).isDirectory(), true);

      const restoredEndpoint = await restoreIpcEndpoint(server.endpoint.value, endpointOptions);
      assert.notEqual(restoredEndpoint, undefined);
      const restoredServer = await startWindowContextServer({
        endpoint: restoredEndpoint,
        endpointOptions,
        preservePrivateDirectory: true,
        getContext: () => ({ version: 1, focused: true }),
        logger: { error() {} }
      });
      try {
        assert.deepEqual(
          (await requestOverSocket(server.endpoint.value, "GET", "/v1/window-context")).body,
          { version: 1, focused: true }
        );
      } finally {
        await restoredServer.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function requestOverSocket(
  socketPath: string,
  method: string,
  path: string
): Promise<{
  status: number;
  contentType: string | undefined;
  body: unknown;
}> {
  return await new Promise((resolve, reject) => {
    const client = request(
      {
        socketPath,
        method,
        path,
        headers: { connection: "close" },
        agent: false
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              contentType: response.headers["content-type"],
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
            });
          } catch (error: unknown) {
            reject(error);
          }
        });
        response.on("error", reject);
      }
    );
    client.on("error", reject);
    client.end();
  });
}
