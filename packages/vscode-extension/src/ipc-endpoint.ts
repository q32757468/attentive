import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { posix as posixPath } from "node:path";

/** Keep a conservative margin for Unix sockaddr_un implementations. */
export const MAX_UNIX_SOCKET_PATH_LENGTH = 100;
export const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\attentive-vscode-";

export interface IpcEndpoint {
  readonly kind: "pipe" | "socket";
  readonly value: string;
  /** Present only when this activation created a private temporary directory. */
  readonly privateDirectory?: string;
}

export type IpcEndpointFileSystem = Pick<
  typeof fs,
  "chmod" | "lstat" | "mkdtemp" | "rmdir" | "unlink"
>;

export interface IpcEndpointOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  tempDirectory?: () => string;
  randomBytesImpl?: (size: number) => Buffer;
  currentUid?: () => number | undefined;
  fileSystem?: IpcEndpointFileSystem;
  maxUnixSocketPathLength?: number;
}

export const defaultIpcEndpointFileSystem: IpcEndpointFileSystem = {
  chmod: fs.chmod,
  lstat: fs.lstat,
  mkdtemp: fs.mkdtemp,
  rmdir: fs.rmdir,
  unlink: fs.unlink
};

export async function createIpcEndpoint(
  options: IpcEndpointOptions = {}
): Promise<IpcEndpoint> {
  const platform = options.platform ?? process.platform;
  const token = (options.randomBytesImpl ?? randomBytes)(16).toString("hex");

  if (platform === "win32") {
    return {
      kind: "pipe",
      value: `${WINDOWS_PIPE_PREFIX}${token}-sock`
    };
  }

  const fileSystem = options.fileSystem ?? defaultIpcEndpointFileSystem;
  const maxPathLength = options.maxUnixSocketPathLength ?? MAX_UNIX_SOCKET_PATH_LENGTH;
  const env = options.env ?? process.env;
  const runtimeDirectory = env.XDG_RUNTIME_DIR;
  if (
    runtimeDirectory &&
    await isSecureDirectory(runtimeDirectory, options, fileSystem)
  ) {
    const runtimeSocket = posixPath.join(runtimeDirectory, `attentive-${token}.sock`);
    if (isSocketPathWithinLimit(runtimeSocket, maxPathLength)) {
      return { kind: "socket", value: runtimeSocket };
    }
  }

  const privateDirectory = await createPrivateDirectory(options, fileSystem);
  const socketPath = posixPath.join(privateDirectory, `a-${token}.sock`);
  if (!isSocketPathWithinLimit(socketPath, maxPathLength)) {
    await cleanupPrivateDirectory(privateDirectory, fileSystem);
    throw new Error("unable to create a short enough Unix socket endpoint");
  }

  return {
    kind: "socket",
    value: socketPath,
    privateDirectory
  };
}

/**
 * Restores an endpoint previously written by this extension to VS Code's
 * persistent terminal environment collection. The directory is revalidated
 * before the endpoint is trusted across an Extension Host reload.
 */
export async function restoreIpcEndpoint(
  value: string,
  options: IpcEndpointOptions = {}
): Promise<IpcEndpoint | undefined> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return /^\\\\\.\\pipe\\attentive-vscode-[a-f0-9]{32}-sock$/.test(value)
      ? { kind: "pipe", value }
      : undefined;
  }

  const maxPathLength = options.maxUnixSocketPathLength ?? MAX_UNIX_SOCKET_PATH_LENGTH;
  if (!posixPath.isAbsolute(value) || !isSocketPathWithinLimit(value, maxPathLength)) {
    return undefined;
  }

  const fileSystem = options.fileSystem ?? defaultIpcEndpointFileSystem;
  const directory = posixPath.dirname(value);
  const name = posixPath.basename(value);
  const runtimeDirectory = (options.env ?? process.env).XDG_RUNTIME_DIR;
  const isRuntimeSocket = runtimeDirectory !== undefined &&
    posixPath.resolve(runtimeDirectory) === directory &&
    /^attentive-[a-f0-9]{32}\.sock$/.test(name);
  const temporaryRoot = posixPath.resolve((options.tempDirectory ?? tmpdir)());
  const privateDirectoryName = posixPath.basename(directory);
  const isPrivateSocket = posixPath.dirname(directory) === temporaryRoot &&
    /^attentive-[^/]+$/.test(privateDirectoryName) &&
    /^a-[a-f0-9]{32}\.sock$/.test(name);

  if (
    (!isRuntimeSocket && !isPrivateSocket) ||
    !await isSecureDirectory(directory, options, fileSystem)
  ) {
    return undefined;
  }

  // Do not restore privateDirectory metadata: the directory must remain in
  // place so this cached endpoint can be rebound after the next reload.
  return { kind: "socket", value };
}

export function isSocketPathWithinLimit(
  value: string,
  maxLength = MAX_UNIX_SOCKET_PATH_LENGTH
): boolean {
  return Buffer.byteLength(value, "utf8") <= maxLength;
}

export async function cleanupIpcEndpoint(
  endpoint: IpcEndpoint,
  fileSystem: IpcEndpointFileSystem = defaultIpcEndpointFileSystem,
  options: { removeSocket?: boolean } = {}
): Promise<void> {
  if (endpoint.kind !== "socket") {
    return;
  }

  if (options.removeSocket !== false) {
    await ignoreFilesystemError(() => fileSystem.unlink(endpoint.value));
  }
  if (endpoint.privateDirectory) {
    await cleanupPrivateDirectory(endpoint.privateDirectory, fileSystem);
  }
}

async function createPrivateDirectory(
  options: IpcEndpointOptions,
  fileSystem: IpcEndpointFileSystem
): Promise<string> {
  const root = (options.tempDirectory ?? tmpdir)();
  const directory = await fileSystem.mkdtemp(posixPath.join(root, "attentive-"));
  try {
    await fileSystem.chmod(directory, 0o700);
    if (!await isSecureDirectory(directory, options, fileSystem)) {
      throw new Error("private temporary directory has insecure permissions");
    }
    return directory;
  } catch (error: unknown) {
    await cleanupPrivateDirectory(directory, fileSystem);
    throw error;
  }
}

async function isSecureDirectory(
  directory: string,
  options: IpcEndpointOptions,
  fileSystem: IpcEndpointFileSystem
): Promise<boolean> {
  try {
    const stats = await fileSystem.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return false;
    }
    if ((stats.mode & 0o077) !== 0) {
      return false;
    }
    const uid = options.currentUid?.() ?? getCurrentUid();
    return uid !== undefined && stats.uid === uid;
  } catch {
    return false;
  }
}

function getCurrentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

async function cleanupPrivateDirectory(
  directory: string,
  fileSystem: IpcEndpointFileSystem
): Promise<void> {
  await ignoreFilesystemError(() => fileSystem.rmdir(directory));
}

async function ignoreFilesystemError(
  operation: () => Promise<unknown>
): Promise<void> {
  try {
    await operation();
  } catch {
    // Cleanup is best effort. The endpoint is random and is never reused.
  }
}
