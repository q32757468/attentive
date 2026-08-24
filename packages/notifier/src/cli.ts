#!/usr/bin/env node

import {
  DEFAULT_NOTIFIER_HOST,
  DEFAULT_NOTIFIER_PORT
} from "@attentive/protocol";
import { basename } from "node:path";
import { startNotifier } from "./server.js";

interface NotifierCliArgs {
  host?: string;
  port?: number;
  help: boolean;
}

export async function runNotifierCli(
  argv: readonly string[] = process.argv.slice(2),
  io: Pick<typeof console, "log" | "error"> = console,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.log(notifierHelp());
      return 0;
    }

    const host = args.host ?? env.ATTENTIVE_NOTIFIER_HOST ?? DEFAULT_NOTIFIER_HOST;
    const port = args.port ?? parsePort(env.ATTENTIVE_NOTIFIER_PORT) ?? DEFAULT_NOTIFIER_PORT;
    const server = await startNotifier({ host, port });
    const address = server.address();
    const displayAddress = typeof address === "object" && address !== null
      ? `${address.address}:${address.port}`
      : `${host}:${port}`;
    io.log(`Attentive notifier listening on ${displayAddress}`);
    return 0;
  } catch (error: unknown) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseArgs(argv: readonly string[]): NotifierCliArgs {
  const result: NotifierCliArgs = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }

    const [name, inlineValue] = token.split("=", 2);
    if (name !== "--host" && name !== "--port") {
      throw new Error(`unknown option: ${token}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--host") {
      result.host = value;
    } else {
      const port = parsePort(value);
      if (port === undefined) {
        throw new Error("--port must be an integer between 0 and 65535");
      }
      result.port = port;
    }
  }
  return result;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const port = Number(value);
  return port >= 0 && port <= 65535 ? port : undefined;
}

function notifierHelp(): string {
  return `Usage: attentive-notifier [options]

Starts the Windows notification HTTP service.

Options:
  --host <address>  Listen address (default: ${DEFAULT_NOTIFIER_HOST})
  --port <port>     Listen port (default: ${DEFAULT_NOTIFIER_PORT})
  -h, --help        Show this help`;
}

if (process.argv[1] && (basename(process.argv[1]) === "cli.js" || basename(process.argv[1]) === "cli.ts")) {
  void runNotifierCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
