const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");
const {
  resolveNpxInvocation,
  runNpx,
} = require("../scripts/attentive-codex-notify.js");

const HOOK_PATH = path.resolve(__dirname, "../scripts/attentive-codex-notify.js");

function createHookHarness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attentive-codex-notify-"));
  const codexHome = path.join(directory, "codex-home");
  const argsPath = path.join(directory, "npx-invocation.json");
  const npxScript = `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.FAKE_NPX_ARGS_PATH, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
}));
if (process.env.FAKE_NPX_STDOUT) process.stdout.write(process.env.FAKE_NPX_STDOUT);
if (process.env.FAKE_NPX_STDERR) process.stderr.write(process.env.FAKE_NPX_STDERR);
process.exitCode = Number(process.env.FAKE_NPX_EXIT_CODE || 0);
`;

  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(directory, "npx"), npxScript, { mode: 0o755 });
  const windowsNpxPath = path.join(directory, "node_modules", "npm", "bin", "npx-cli.js");
  fs.mkdirSync(path.dirname(windowsNpxPath), { recursive: true });
  fs.writeFileSync(windowsNpxPath, npxScript);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  return {
    argsPath,
    codexHome,
    directory,
    run(input, environment = {}) {
      return spawnSync(process.execPath, [
        HOOK_PATH,
        "--notifier-url",
        "http://127.0.0.1:8765",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          FAKE_NPX_ARGS_PATH: argsPath,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
          ...environment,
        },
        input: typeof input === "string" ? input : JSON.stringify(input),
      });
    },
    readInvocation() {
      return JSON.parse(fs.readFileSync(argsPath, "utf8"));
    },
  };
}

function stopPayload(overrides = {}) {
  return {
    hook_event_name: "Stop",
    last_assistant_message: "Done & safe",
    ...overrides,
  };
}

function valueAfter(args, flag) {
  return args[args.indexOf(flag) + 1];
}

describe("attentive Codex notification runner", () => {
  it("runs npx directly outside Windows", () => {
    assert.deepEqual(resolveNpxInvocation({ platform: "linux" }), {
      command: "npx",
      args: [],
    });
  });

  it("runs npx-cli.js with node.exe on Windows", () => {
    const nodePath = String.raw`C:\Program Files\nodejs\node.exe`;
    const npxPath = String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js`;

    assert.deepEqual(resolveNpxInvocation({
      platform: "win32",
      execPath: nodePath,
      env: {},
      existsSync: (candidate) => candidate === npxPath,
    }), {
      command: nodePath,
      args: [npxPath],
    });
  });

  it("uses npm_execpath to locate the Windows npx entry point", () => {
    const nodePath = String.raw`D:\tools\node.exe`;
    const npmPath = String.raw`C:\npm\bin\npm-cli.js`;
    const npxPath = String.raw`C:\npm\bin\npx-cli.js`;

    assert.deepEqual(resolveNpxInvocation({
      platform: "win32",
      execPath: nodePath,
      env: { npm_execpath: npmPath },
      existsSync: (candidate) => candidate === npxPath,
    }), {
      command: nodePath,
      args: [npxPath],
    });
  });

  it("fails clearly when the Windows npx entry point is unavailable", () => {
    assert.throws(() => resolveNpxInvocation({
      platform: "win32",
      execPath: String.raw`C:\missing\node.exe`,
      env: {},
      existsSync: () => false,
    }), /Could not locate npm's npx-cli\.js/);
  });

  it("does not use a shell and preserves argument boundaries", () => {
    const calls = [];
    runNpx(["notify", "--body", "hello & goodbye"], {
      invocation: { command: "node.exe", args: ["npx-cli.js"] },
      spawnSync: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "node.exe");
    assert.deepEqual(calls[0].args, [
      "npx-cli.js",
      "notify",
      "--body",
      "hello & goodbye",
    ]);
    assert.equal(calls[0].options.shell, false);
  });

  it("surfaces spawn and command failures", () => {
    assert.throws(() => runNpx([], {
      invocation: { command: "node.exe", args: ["npx-cli.js"] },
      spawnSync: () => ({ error: new Error("spawn ENOENT") }),
    }), /spawn ENOENT/);

    assert.throws(() => runNpx([], {
      invocation: { command: "node.exe", args: ["npx-cli.js"] },
      spawnSync: () => ({ status: 7, stdout: "", stderr: "notify failed" }),
    }), /exit code 7[\s\S]*notify failed/);
  });
});

describe("hook entry point", () => {
  it("reports invalid JSON as a failure", (t) => {
    const harness = createHookHarness(t);
    const result = harness.run("not JSON");

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Failed to parse the hook payload as JSON/);
    assert.equal(fs.existsSync(harness.argsPath), false);
  });

  it("quietly skips irrelevant events and empty responses", (t) => {
    const harness = createHookHarness(t);

    for (const payload of [
      { hook_event_name: "BeforeAgent", last_assistant_message: "ignored" },
      stopPayload({ last_assistant_message: "  " }),
    ]) {
      const result = harness.run(payload);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(fs.existsSync(harness.argsPath), false);
    }
  });

  it("outputs the hook acknowledgement only after notification succeeds", (t) => {
    const harness = createHookHarness(t);
    const result = harness.run(stopPayload({ cwd: harness.directory }), {
      FAKE_NPX_STDOUT: "npx output that must not leak",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "{}\n");
    assert.equal(result.stderr, "");
    const invocation = harness.readInvocation();
    assert.equal(invocation.cwd, harness.directory);
    assert.deepEqual(invocation.args, [
      "-y",
      "@attentive-kit/cli",
      "notify",
      "--title",
      "Codex",
      "--body",
      "Done & safe",
      "--notifier-url",
      "http://127.0.0.1:8765",
      "--source",
      "codex",
    ]);
  });

  it("does not acknowledge a failed notification", (t) => {
    const harness = createHookHarness(t);
    const result = harness.run(stopPayload(), {
      FAKE_NPX_EXIT_CODE: "7",
      FAKE_NPX_STDERR: "notification rejected",
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /exit code 7/);
    assert.match(result.stderr, /notification rejected/);
  });
});

describe("notification title fallback", () => {
  it("uses the newest matching session title before the transcript", (t) => {
    const harness = createHookHarness(t);
    const sessionId = "session-123";
    fs.writeFileSync(path.join(harness.codexHome, "session_index.jsonl"), [
      JSON.stringify({ id: sessionId, thread_name: "Older title" }),
      JSON.stringify({ id: "another-session", thread_name: "Other title" }),
      JSON.stringify({ id: sessionId, thread_name: "Newest title" }),
    ].join("\n"));
    const transcriptPath = path.join(harness.directory, "transcript.jsonl");
    fs.writeFileSync(transcriptPath, JSON.stringify({
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Transcript title" }],
      },
    }));

    const result = harness.run(stopPayload({
      session_id: sessionId,
      transcript_path: transcriptPath,
    }));

    assert.equal(result.status, 0);
    assert.equal(valueAfter(harness.readInvocation().args, "--title"), "Newest title");
  });

  it("warns about a damaged index and falls back to the first real user message", (t) => {
    const harness = createHookHarness(t);
    fs.writeFileSync(
      path.join(harness.codexHome, "session_index.jsonl"),
      "incomplete JSON",
    );
    const transcriptPath = path.join(harness.directory, "transcript.jsonl");
    fs.writeFileSync(transcriptPath, [
      "damaged transcript line",
      JSON.stringify({
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>ignored</environment_context>" }],
        },
      }),
      JSON.stringify({
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "input_text", text: "Assistant title" }],
        },
      }),
      JSON.stringify({
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "  Actual user title  " }],
        },
      }),
    ].join("\n"));

    const result = harness.run(stopPayload({
      session_id: "missing-session",
      transcript_path: transcriptPath,
    }));

    assert.equal(result.status, 0);
    assert.match(result.stderr, /invalid line in session index/);
    assert.match(result.stderr, /invalid line in transcript/);
    assert.equal(valueAfter(harness.readInvocation().args, "--title"), "Actual user title");
  });
});
