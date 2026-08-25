import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_NOTIFIER_URL,
  isHttpUrl
} from "@attentive-kit/protocol";

export interface CliConfigFile {
  notifierUrl?: string;
  notifier?: {
    url?: string;
  };
}

export interface ResolvedCliConfig {
  notifierUrl: string;
  configPath: string;
}

export function getDefaultConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Attentive", "config.json");
  }
  const configHome = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "attentive", "config.json");
}

export function loadConfigFile(filePath: string): CliConfigFile {
  if (!existsSync(filePath)) {
    return {};
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new Error(`unable to read config file: ${filePath}`);
  }

  if (!isRecord(value)) {
    throw new Error(`config file must contain a JSON object: ${filePath}`);
  }

  const notifierUrl = value.notifierUrl;
  const notifier = value.notifier;
  if (notifierUrl !== undefined && typeof notifierUrl !== "string") {
    throw new Error("config notifierUrl must be a string");
  }
  if (notifier !== undefined && !isRecord(notifier)) {
    throw new Error("config notifier must be an object");
  }
  if (isRecord(notifier) && notifier.url !== undefined && typeof notifier.url !== "string") {
    throw new Error("config notifier.url must be a string");
  }

  return {
    notifierUrl: notifierUrl as string | undefined,
    notifier: isRecord(notifier)
      ? { url: notifier.url as string | undefined }
      : undefined
  };
}

export function resolveCliConfig(options: {
  cliNotifierUrl?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ResolvedCliConfig {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? env.ATTENTIVE_CONFIG_FILE ?? getDefaultConfigPath(process.platform, env);
  const config = options.cliNotifierUrl === undefined && env.ATTENTIVE_NOTIFIER_URL === undefined
    ? loadConfigFile(configPath)
    : {};
  const notifierUrl = options.cliNotifierUrl
    ?? env.ATTENTIVE_NOTIFIER_URL
    ?? config.notifierUrl
    ?? config.notifier?.url
    ?? DEFAULT_NOTIFIER_URL;

  if (!isHttpUrl(notifierUrl)) {
    throw new Error("notifier URL must use the http or https protocol");
  }

  return { notifierUrl: notifierUrl.replace(/\/$/, ""), configPath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
