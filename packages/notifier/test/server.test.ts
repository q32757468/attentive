import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startNotifier } from "../src/server.js";

describe("notifier HTTP server", () => {
  it("validates and dispatches a notification request", async () => {
    const received: unknown[] = [];
    const server = await startNotifier({
      host: "127.0.0.1",
      port: 0,
      dispatcher: async (request, notificationId) => {
        received.push({ request, notificationId });
      },
      logger: { info() {}, error() {} }
    });

    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      if (!address || typeof address === "string") {
        throw new Error("test server did not expose a TCP address");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Build complete",
          body: "The build passed",
          source: "test",
          action: { type: "open-uri", uri: "https://example.com/build/1" },
          metadata: { buildId: 1 }
        })
      });

      assert.equal(response.status, 201);
      const result = await response.json() as { notificationId: string };
      assert.match(result.notificationId, /^[0-9a-f-]{36}$/);
      assert.equal(received.length, 1);
      assert.deepEqual((received[0] as { request: unknown }).request, {
        title: "Build complete",
        body: "The build passed",
        source: "test",
        action: { type: "open-uri", uri: "https://example.com/build/1" },
        metadata: { buildId: 1 }
      });
    } finally {
      await closeServer(server);
    }
  });

  it("omits source from submission logs when it is not provided", async () => {
    const infoContexts: Array<Record<string, unknown>> = [];
    const server = await startNotifier({
      host: "127.0.0.1",
      port: 0,
      dispatcher: () => undefined,
      logger: {
        info(_message, context) {
          if (context) {
            infoContexts.push(context);
          }
        },
        error() {}
      }
    });

    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      if (!address || typeof address === "string") {
        throw new Error("test server did not expose a TCP address");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Build", body: "Done" })
      });

      assert.equal(response.status, 201);
      assert.equal(infoContexts.length, 1);
      assert.equal("source" in infoContexts[0], false);
    } finally {
      await closeServer(server);
    }
  });

  it("returns structured validation errors and health status", async () => {
    const server = await startNotifier({
      host: "127.0.0.1",
      port: 0,
      dispatcher: () => undefined,
      logger: { info() {}, error() {} }
    });

    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      if (!address || typeof address === "string") {
        throw new Error("test server did not expose a TCP address");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const invalidResponse = await fetch(`${baseUrl}/api/v1/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Missing body" })
      });
      assert.equal(invalidResponse.status, 400);
      assert.deepEqual(await invalidResponse.json(), {
        error: { code: "INVALID_REQUEST", message: "body is required" }
      });

      const healthResponse = await fetch(`${baseUrl}/health`);
      assert.equal(healthResponse.status, 200);
      assert.deepEqual(await healthResponse.json(), { status: "ok" });
    } finally {
      await closeServer(server);
    }
  });

  it("converts dispatcher failures into structured server errors", async () => {
    const server = await startNotifier({
      host: "127.0.0.1",
      port: 0,
      dispatcher: () => {
        throw new Error("toast unavailable");
      },
      logger: { info() {}, error() {} }
    });

    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      if (!address || typeof address === "string") {
        throw new Error("test server did not expose a TCP address");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Build", body: "Body" })
      });

      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: { code: "INTERNAL_ERROR", message: "unable to submit notification" }
      });
    } finally {
      await closeServer(server);
    }
  });
});

async function closeServer(server: { close(callback: (error?: Error) => void): void }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
