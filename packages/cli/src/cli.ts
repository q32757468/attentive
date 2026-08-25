#!/usr/bin/env node

import {
  isHttpUrl,
  isOpenUri,
  validateNotificationRequest,
  type NotificationRequest
} from "@attentive/protocol";
import { basename } from "node:path";
import { resolveCliConfig } from "./config.js";

export interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface CliDependencies {
  fetchImpl?: typeof fetch;
  io?: CliIo;
  env?: NodeJS.ProcessEnv;
}

interface NotifyArgs {
  title?: string;
  body?: string;
  source?: string;
  url?: string;
  metadata?: string;
  notifierUrl?: string;
  configPath?: string;
  timeoutMs?: number;
  help: boolean;
}

export async function run(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: CliDependencies = {}
): Promise<number> {
  const io = dependencies.io ?? {
    stdout: (message: string) => process.stdout.write(`${message}\n`),
    stderr: (message: string) => process.stderr.write(`${message}\n`)
  };

  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      io.stdout(cliHelp());
      return 0;
    }

    const request = createRequest(parsed, dependencies.env ?? process.env, io);
    const config = resolveCliConfig({
      cliNotifierUrl: parsed.notifierUrl,
      configPath: parsed.configPath,
      env: dependencies.env
    });
    const response = await sendNotification(
      config.notifierUrl,
      request,
      parsed.timeoutMs ?? 10_000,
      dependencies.fetchImpl ?? fetch
    );

    io.stdout(`Notification sent: ${response.notificationId}`);
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseArgs(argv: readonly string[]): NotifyArgs {
  const result: NotifyArgs = { help: false };
  if (argv.length === 0 || (argv[0] !== "notify" && argv[0] !== "--help" && argv[0] !== "-h")) {
    throw new Error("the notify command is required\n\n" + cliHelp());
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    return { help: true };
  }

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }
    const [name, inlineValue] = token.split("=", 2);
    const allowed = new Set([
      "--title",
      "--body",
      "--source",
      "--url",
      "--metadata",
      "--notifier-url",
      "--config",
      "--timeout"
    ]);
    if (!allowed.has(name)) {
      throw new Error(`unknown option: ${token}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || (value.startsWith("--") && inlineValue === undefined)) {
      throw new Error(`${name} requires a value`);
    }

    switch (name) {
      case "--title":
        result.title = value;
        break;
      case "--body":
        result.body = value;
        break;
      case "--source":
        result.source = value;
        break;
      case "--url":
        result.url = value;
        break;
      case "--metadata":
        result.metadata = value;
        break;
      case "--notifier-url":
        result.notifierUrl = value;
        break;
      case "--config":
        result.configPath = value;
        break;
      case "--timeout": {
        const timeoutMs = Number(value);
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
          throw new Error("--timeout must be a positive integer in milliseconds");
        }
        result.timeoutMs = timeoutMs;
        break;
      }
    }
  }
  return result;
}

function createRequest(
  args: NotifyArgs,
  env: NodeJS.ProcessEnv,
  io: CliIo
): NotificationRequest {
  let metadata: unknown;
  if (args.metadata !== undefined) {
    try {
      metadata = JSON.parse(args.metadata) as unknown;
    } catch {
      throw new Error("--metadata must contain valid JSON");
    }
  }

  if (args.url !== undefined && !isHttpUrl(args.url)) {
    throw new Error("--url must use the http or https protocol");
  }

  let action: NotificationRequest["action"];
  if (args.url !== undefined) {
    action = { type: "open-uri", uri: args.url };
  } else if (env.ATTENTIVE_VSCODE_CALLBACK_URI !== undefined) {
    const callbackUri = env.ATTENTIVE_VSCODE_CALLBACK_URI;
    if (isOpenUri(callbackUri)) {
      action = { type: "open-uri", uri: callbackUri };
    } else {
      io.stderr("Warning: ignoring invalid ATTENTIVE_VSCODE_CALLBACK_URI");
    }
  }

  return validateNotificationRequest({
    title: args.title,
    body: args.body,
    source: args.source,
    action,
    metadata
  });
}

async function sendNotification(
  notifierUrl: string,
  request: NotificationRequest,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ notificationId: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${notifierUrl}/api/v1/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    const payload = await readJson(response);

    if (!response.ok) {
      if (isApiErrorPayload(payload)) {
        throw new Error(`${payload.error.code}: ${payload.error.message}`);
      }
      throw new Error(`notifier returned HTTP ${response.status}`);
    }
    if (!isCreateNotificationResponse(payload)) {
      throw new Error("notifier returned an invalid success response");
    }
    return payload;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`notifier request timed out after ${timeoutMs} ms`);
    }
    if (error instanceof TypeError) {
      throw new Error(`unable to connect to notifier at ${notifierUrl}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function isApiErrorPayload(value: unknown): value is { error: { code: string; message: string } } {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }
  return typeof value.error.code === "string" && typeof value.error.message === "string";
}

function isCreateNotificationResponse(value: unknown): value is { notificationId: string } {
  return isRecord(value) && typeof value.notificationId === "string" && value.notificationId.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cliHelp(): string {
  return `Usage: attentive notify [options]

Options:
  --title <text>          Notification title (required)
  --body <text>           Notification body (required)
  --source <name>         Source identifier
  --url <http(s) URL>     URL opened when the notification is clicked
  --metadata <JSON>       Debug metadata object
  --notifier-url <URL>    Notifier address
  --config <path>         Config file path
  --timeout <milliseconds> Request timeout (default: 10000)
  -h, --help              Show this help`;
}

if (process.argv[1] && (basename(process.argv[1]) === "cli.js" || basename(process.argv[1]) === "cli.ts")) {
  void run().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
