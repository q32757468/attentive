#!/usr/bin/env node

const { existsSync, readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { detectNotifierUrl } = require("./detect-notifier-url.js");

const payloadText = readStdin();

let payload;
try {
  payload = JSON.parse(payloadText);
} catch {
  process.exit(0);
}

if (payload?.hook_event_name !== "Stop") {
  process.exit(0);
}

const body = typeof payload.last_assistant_message === "string"
  ? payload.last_assistant_message.trim()
  : "";
if (!body) {
  process.exit(0);
}

const sessionId = typeof payload.session_id === "string"
  ? payload.session_id
  : "";
const title = findSessionTitle(sessionId)
  ?? firstTranscriptMessage(payload.transcript_path)
  ?? "Codex";

detectNotifierUrl(readNotifierUrlArg(process.argv.slice(2))).then((notifierUrl) => {
  spawnSync("npx", [
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
    "codex"
  ], {
    cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
    stdio: "ignore"
  });

  process.stdout.write("{}\n");
});

function readNotifierUrlArg(args) {
  const inlineArg = args.find((arg) => arg.startsWith("--notifier-url="));
  if (inlineArg) {
    return inlineArg.slice("--notifier-url=".length).trim() || undefined;
  }

  const argIndex = args.indexOf("--notifier-url");
  const value = argIndex >= 0 ? args[argIndex + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function findSessionTitle(id) {
  if (!id) {
    return undefined;
  }

  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const indexPath = join(codexHome, "session_index.jsonl");
  if (!existsSync(indexPath)) {
    return undefined;
  }

  let lines;
  try {
    lines = readFileSync(indexPath, "utf8").trimEnd().split("\n").reverse();
  } catch {
    return undefined;
  }

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry?.id === id && typeof entry.thread_name === "string") {
        const title = entry.thread_name.trim();
        if (title) {
          return title;
        }
      }
    } catch {
      // Ignore an incomplete line while Codex is updating the index.
    }
  }
  return undefined;
}

function firstTranscriptMessage(transcriptPath) {
  if (typeof transcriptPath !== "string" || !existsSync(transcriptPath)) {
    return undefined;
  }

  let lines;
  try {
    lines = readFileSync(transcriptPath, "utf8").split("\n");
  } catch {
    return undefined;
  }

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const item = entry?.payload;
      if (item?.type !== "message" || item.role !== "user") {
        continue;
      }

      const text = Array.isArray(item.content)
        ? item.content
          .filter((part) => part?.type === "input_text")
          .map((part) => part.text)
          .filter((part) => typeof part === "string")
          .join("\n")
        : "";
      const title = text.trim();
      if (title && !title.startsWith("<environment_context>")) {
        return title;
      }
    } catch {
      // Ignore incomplete or non-message transcript lines.
    }
  }
  return undefined;
}
