#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { lookup } = require("node:dns/promises");
const { existsSync, readFileSync } = require("node:fs");
const { isIP } = require("node:net");

const DEFAULT_NOTIFIER_URL = "http://127.0.0.1:8765";
const DOCKER_HOSTNAME = "host.docker.internal";
const NOTIFIER_PORT = 8765;

async function detectNotifierUrl(configuredUrl) {
  configuredUrl = configuredUrl?.trim() || process.env.NOTIFIER_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  if (isContainerEnvironment()) {
    if (await canResolveHost(DOCKER_HOSTNAME)) {
      return notifierUrl(DOCKER_HOSTNAME);
    }
  }

  if (isWslEnvironment()) {
    if (readWslNetworkingMode() === "mirrored") {
      return DEFAULT_NOTIFIER_URL;
    }

    const wslHost = readDefaultGateway();
    if (wslHost) {
      return notifierUrl(wslHost);
    }
  }

  return DEFAULT_NOTIFIER_URL;
}

function canResolveHost(hostname) {
  return lookup(hostname, { family: 4 }).then(
    () => true,
    () => false,
  );
}

function isContainerEnvironment() {
  if (
    existsSync("/.dockerenv") ||
    existsSync("/run/.containerenv") ||
    process.env.container
  ) {
    return true;
  }

  const cgroup = readTextFile("/proc/1/cgroup");
  return /(?:docker|containerd|kubepods|libpod|lxc)/i.test(cgroup);
}

function isWslEnvironment() {
  if (process.platform !== "linux") {
    return false;
  }

  if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME) {
    return true;
  }

  return /microsoft|wsl/i.test(
    `${readTextFile("/proc/sys/kernel/osrelease")}\n${readTextFile("/proc/version")}`,
  );
}

function readWslNetworkingMode() {
  return runCommand("wslinfo", ["--networking-mode"]).toLowerCase();
}

function readDefaultGateway() {
  const routes = runCommand("ip", ["-4", "route", "show", "default"]);

  for (const route of routes.split("\n")) {
    const fields = route.trim().split(/\s+/);
    const viaIndex = fields.indexOf("via");
    if (viaIndex >= 0) {
      const address = fields[viaIndex + 1];
      if (isIP(address) === 4) {
        return address;
      }
    }
  }

  return "";
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
  } catch {
    return "";
  }
}

function notifierUrl(host) {
  return `http://${host}:${NOTIFIER_PORT}`;
}

function readTextFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

module.exports = { detectNotifierUrl };

if (require.main === module) {
  detectNotifierUrl().then((notifierUrl) => {
    process.stdout.write(`${notifierUrl}\n`);
  });
}
