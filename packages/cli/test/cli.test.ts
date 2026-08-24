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
