#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

spawnSync("npx", [
  "-y",
  "@attentive-kit/cli",
  "notify",
  "--title",
  title,
  "--body",
  body,
  "--notifier-url",
  "http://192.168.31.17:8765",
  "--source",
  "codex"
], {
  cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
  stdio: "ignore"
});

process.stdout.write("{}\n");

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
