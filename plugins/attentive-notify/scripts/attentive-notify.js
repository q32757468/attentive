#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { detectNotifierUrl } = require("./detect-notifier-url.js");

const ERROR_PREFIX = "[attentive-notify]";

async function main() {
  const payloadText = fs.readFileSync(0, "utf8");

  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    throw new Error("Failed to parse the hook payload as JSON.", { cause: error });
  }

  if (payload?.hook_event_name !== "Stop") {
    return;
  }

  // Claude Code sets this when a Stop hook is running as a result of another
  // Stop hook. Do not create a notification loop when that guard is active.
  if (payload.stop_hook_active === true) {
    return;
  }

  const claudeCodePayload = isClaudeCodePayload(payload);

  const body = typeof payload.last_assistant_message === "string"
    ? payload.last_assistant_message.trim()
    : "";
  if (!body) {
    return;
  }

  const sessionId = typeof payload.session_id === "string"
    ? payload.session_id
    : "";
  const title = findSessionTitle(sessionId)
    ?? firstTranscriptMessage(payload.transcript_path)
    ?? (claudeCodePayload ? "Claude Code" : "Codex");
  const notifierUrl = await detectNotifierUrl(readNotifierUrlArg(process.argv.slice(2)));

  runNpx([
    "-y",
    "@attentive-kit/cli",
    "notify",
    "--title",
    title,
    "--body",
    body,
    "--notifier-url",
    notifierUrl,
    "--source",
    claudeCodePayload ? "claude-code" : "codex"
  ], {
    cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
  });

  process.stdout.write("{}\n");
}

function isClaudeCodePayload(payload) {
  return Object.prototype.hasOwnProperty.call(payload, "stop_hook_active");
}

function runNpx(args, options = {}) {
  const invocation = options.invocation ?? resolveNpxInvocation();
  const spawn = options.spawnSync ?? spawnSync;
  const result = spawn(invocation.command, [...invocation.args, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(
      `Failed to start the notification command (${formatInvocation(invocation)}): ${result.error.message}`,
      { cause: result.error },
    );
  }

  if (result.status !== 0) {
    const exitDescription = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.status}`;
    const output = [result.stderr, result.stdout]
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `Notification command failed with ${exitDescription}.${output ? `\n${output}` : ""}`,
    );
  }
}

function resolveNpxInvocation(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { command: "npx", args: [] };
  }

  const execPath = options.execPath ?? process.execPath;
  const environment = options.env ?? process.env;
  const fileExists = options.existsSync ?? fs.existsSync;
  const pathApi = options.pathApi ?? path.win32;
  const tempRoot = typeof options.tmpdir === "function"
    ? options.tmpdir()
    : (options.tmpdir ?? os.tmpdir());
  const cacheDir = pathApi.join(tempRoot, "attentive");
  const candidates = [];

  if (/npm-cli\.js$/i.test(environment.npm_execpath ?? "")) {
    candidates.push(pathApi.join(pathApi.dirname(environment.npm_execpath), "npx-cli.js"));
  }

  candidates.push(pathApi.join(
    pathApi.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  ));

  for (const directory of (environment.PATH ?? environment.Path ?? "").split(";")) {
    if (directory) {
      candidates.push(pathApi.join(directory, "node_modules", "npm", "bin", "npx-cli.js"));
    }
  }

  const npxCliPath = [...new Set(candidates)].find(fileExists);
  if (!npxCliPath) {
    throw new Error(
      "Could not locate npm's npx-cli.js. Reinstall Node.js with npm, or run the hook from an environment where npm is available.",
    );
  }

  // .cmd files require a command shell on Windows. Running npm's JavaScript
  // entry point with node.exe keeps shell parsing disabled and arguments intact.
  return { command: execPath, args: [npxCliPath, "--cache", cacheDir] };
}

function formatInvocation(invocation) {
  return [invocation.command, ...invocation.args].join(" ");
}

function readNotifierUrlArg(args) {
  const inlineArg = args.find((arg) => arg.startsWith("--notifier-url="));
  if (inlineArg) {
    return inlineArg.slice("--notifier-url=".length).trim() || undefined;
  }

  const argIndex = args.indexOf("--notifier-url");
  const value = argIndex >= 0 ? args[argIndex + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function findSessionTitle(id) {
  if (!id) {
    return undefined;
  }

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const indexPath = path.join(codexHome, "session_index.jsonl");
  if (!fs.existsSync(indexPath)) {
    return undefined;
  }

  let lines;
  try {
    lines = fs.readFileSync(indexPath, "utf8").trimEnd().split("\n").reverse();
  } catch (error) {
    reportWarning(`Could not read session index ${indexPath}: ${error.message}`);
    return undefined;
  }

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      if (entry?.id === id && typeof entry.thread_name === "string") {
        const title = entry.thread_name.trim();
        if (title) {
          return title;
        }
      }
    } catch (error) {
      reportWarning(`Skipped an invalid line in session index ${indexPath}: ${error.message}`);
    }
  }
  return undefined;
}

function firstTranscriptMessage(transcriptPath) {
  if (typeof transcriptPath !== "string" || !fs.existsSync(transcriptPath)) {
    return undefined;
  }

  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  } catch (error) {
    reportWarning(`Could not read transcript ${transcriptPath}: ${error.message}`);
    return undefined;
  }

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      reportWarning(`Skipped an invalid line in transcript ${transcriptPath}: ${error.message}`);
      continue;
    }

    const item = entry?.payload ?? entry?.message;
    const isCodexUserMessage = item?.type === "message" && item.role === "user";
    const isClaudeCodeUserMessage = entry?.type === "user" && item?.role === "user";
    if (!isCodexUserMessage && !isClaudeCodeUserMessage) {
      continue;
    }

    const text = messageText(item.content);
    const title = text.trim();
    if (title && !title.startsWith("<environment_context>")) {
      return title;
    }
  }
  return undefined;
}

function messageText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part?.type === "input_text" || part?.type === "text")
    .map((part) => part.text)
    .filter((part) => typeof part === "string")
    .join("\n");
}

function reportWarning(message) {
  process.stderr.write(`${ERROR_PREFIX} warning: ${message}\n`);
}

function reportFatal(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${ERROR_PREFIX} ${message}\n`);
  process.exitCode = 1;
}

module.exports = { resolveNpxInvocation, runNpx };

if (require.main === module) {
  main().catch(reportFatal);
}
