import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/cli.js";
import { resolveCliConfig } from "../src/config.js";

describe("attentive CLI", () => {
  it("sends a notification and honors the command-line notifier URL", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const output: string[] = [];

    const exitCode = await run(
      [
        "notify",
        "--title", "Build complete",
        "--body", "The build passed",
        "--source", "test",
        "--metadata", '{"buildId":1}',
        "--notifier-url", "http://127.0.0.1:9876/"
      ],
      {
        env: { ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:9999" },
        io: {
          stdout: (message) => output.push(`out:${message}`),
          stderr: (message) => output.push(`err:${message}`)
        },
        fetchImpl: async (input, init) => {
          requestUrl = String(input);
          requestInit = init;
          return new Response(JSON.stringify({ notificationId: "notification-1" }), {
            status: 201,
            headers: { "content-type": "application/json" }
          });
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(requestUrl, "http://127.0.0.1:9876/api/v1/notifications");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      title: "Build complete",
      body: "The build passed",
      source: "test",
      metadata: { buildId: 1 }
    });
    assert.deepEqual(output, ["out:Notification sent: notification-1"]);
  });

  it("returns a non-zero code for structured notifier errors", async () => {
    const errors: string[] = [];
    const exitCode = await run(
      ["notify", "--title", "Build", "--body", "Failed"],
      {
        env: { ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:8765" },
        io: {
          stdout: () => undefined,
          stderr: (message) => errors.push(message)
        },
        fetchImpl: async () => new Response(JSON.stringify({
          error: { code: "INVALID_REQUEST", message: "body is required" }
        }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
      }
    );

    assert.equal(exitCode, 1);
    assert.deepEqual(errors, ["INVALID_REQUEST: body is required"]);
  });

  it("shows help without making a request", async () => {
    const output: string[] = [];
    const exitCode = await run(["notify", "--help"], {
      io: {
        stdout: (message) => output.push(message),
        stderr: () => undefined
      },
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    assert.equal(exitCode, 0);
    assert.match(output[0], /Usage: attentive notify/);
  });

  it("uses the IPC callback URI when no explicit URL is provided", async () => {
    let body: unknown;
    let queriedEndpoint = "";
    const exitCode = await run(
      ["notify", "--title", "Build", "--body", "Done"],
      {
        env: {
          ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:8765",
          ATTENTIVE_VSCODE_IPC_ENDPOINT: "/tmp/attentive-source.sock"
        },
        io: { stdout() {}, stderr() {} },
        queryWindowContextImpl: async (endpoint) => {
          queriedEndpoint = endpoint;
          return {
            kind: "available",
            context: {
              version: 1,
              focused: false,
              callbackUri: "vscode://attentive.attentive-vscode/focus?window=source"
            }
          };
        },
        fetchImpl: async (_input, init) => {
          body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ notificationId: "notification-2" }), { status: 201 });
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(queriedEndpoint, "/tmp/attentive-source.sock");
    assert.deepEqual(body, {
      title: "Build",
      body: "Done",
      action: {
        type: "open-uri",
        uri: "vscode://attentive.attentive-vscode/focus?window=source"
      }
    });
  });

  it("queries focus before using an explicit URL and gives it action priority", async () => {
    const errors: string[] = [];
    let body: unknown;
    let queried = false;
    const exitCode = await run(
      ["notify", "--title", "Build", "--body", "Done", "--url", "https://example.com/result"],
      {
        env: {
          ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:8765",
          ATTENTIVE_VSCODE_IPC_ENDPOINT: "/tmp/attentive-source.sock"
        },
        io: { stdout() {}, stderr: (message) => errors.push(message) },
        queryWindowContextImpl: async () => {
          queried = true;
          return {
            kind: "available",
            context: {
              version: 1,
              focused: false,
              callbackUri: "vscode://attentive.attentive-vscode/focus?window=source"
            }
          };
        },
        fetchImpl: async (_input, init) => {
          body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ notificationId: "notification-3" }), { status: 201 });
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(queried, true);
    assert.deepEqual(errors, []);
    assert.deepEqual((body as { action: unknown }).action, {
      type: "open-uri",
      uri: "https://example.com/result"
    });
  });

  it("warns and sends a plain notification for an invalid IPC endpoint", async () => {
    const errors: string[] = [];
    let body: unknown;
    const exitCode = await run(
      ["notify", "--title", "Build", "--body", "Done"],
      {
        env: {
          ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:8765",
          ATTENTIVE_VSCODE_IPC_ENDPOINT: ""
        },
        io: { stdout() {}, stderr: (message) => errors.push(message) },
        fetchImpl: async (_input, init) => {
          body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ notificationId: "notification-4" }), { status: 201 });
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(errors, ["Warning: ignoring invalid ATTENTIVE_VSCODE_IPC_ENDPOINT"]);
    assert.deepEqual(body, { title: "Build", body: "Done" });
  });

  it("suppresses a focused notification without contacting the notifier", async () => {
    const output: string[] = [];
    let notifierCalls = 0;
    const exitCode = await run(
      ["notify", "--title", "Build", "--body", "Done", "--url", "https://example.com/result"],
      {
        env: {
          ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:8765",
          ATTENTIVE_VSCODE_IPC_ENDPOINT: "/tmp/attentive-source.sock"
        },
        io: {
          stdout: (message) => output.push(message),
          stderr: () => undefined
        },
        queryWindowContextImpl: async () => ({
          kind: "available",
          context: { version: 1, focused: true }
        }),
        fetchImpl: async () => {
          notifierCalls += 1;
          throw new Error("notifier should not be called");
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.equal(notifierCalls, 0);
    assert.deepEqual(output, [
      "Notification suppressed: source VS Code window is focused"
    ]);
  });

  it("rejects an invalid explicit URL before querying window context", async () => {
    let queryCalls = 0;
    let notifierCalls = 0;
    const errors: string[] = [];
    const exitCode = await run(
      ["notify", "--title", "Build", "--body", "Done", "--url", "javascript:alert(1)"],
      {
        env: {
          ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:8765",
          ATTENTIVE_VSCODE_IPC_ENDPOINT: "/tmp/attentive-source.sock"
        },
        io: { stdout() {}, stderr: (message) => errors.push(message) },
        queryWindowContextImpl: async () => {
          queryCalls += 1;
          return { kind: "available", context: { version: 1, focused: true } };
        },
        fetchImpl: async () => {
          notifierCalls += 1;
          throw new Error("notifier should not be called");
        }
      }
    );

    assert.equal(exitCode, 1);
    assert.equal(queryCalls, 0);
    assert.equal(notifierCalls, 0);
    assert.deepEqual(errors, ["--url must use the http or https protocol"]);
  });

  it("fails open silently when IPC is unavailable and ignores the legacy variable", async () => {
    let body: unknown;
    const errors: string[] = [];
    const exitCode = await run(
      ["notify", "--title", "Build", "--body", "Done"],
      {
        env: {
          ATTENTIVE_NOTIFIER_URL: "http://127.0.0.1:8765",
          ATTENTIVE_VSCODE_IPC_ENDPOINT: "/tmp/attentive-missing.sock",
          ATTENTIVE_VSCODE_CALLBACK_URI: "vscode://old/window"
        },
        io: { stdout() {}, stderr: (message) => errors.push(message) },
        queryWindowContextImpl: async () => ({ kind: "unavailable" }),
        fetchImpl: async (_input, init) => {
          body = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ notificationId: "notification-5" }), { status: 201 });
        }
      }
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(body, { title: "Build", body: "Done" });
  });

  it("resolves notifier address in CLI, environment, config, and default order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "attentive-cli-"));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ notifierUrl: "http://config-host:8765" }));

    try {
      assert.equal(
        resolveCliConfig({ configPath }).notifierUrl,
        "http://config-host:8765"
      );
      assert.equal(
        resolveCliConfig({
          configPath,
          env: { ATTENTIVE_NOTIFIER_URL: "http://env-host:8765" }
        }).notifierUrl,
        "http://env-host:8765"
      );
      assert.equal(
        resolveCliConfig({
          cliNotifierUrl: "http://cli-host:8765",
          configPath,
          env: { ATTENTIVE_NOTIFIER_URL: "http://env-host:8765" }
        }).notifierUrl,
        "http://cli-host:8765"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
