import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_UNIX_SOCKET_PATH_LENGTH,
  cleanupIpcEndpoint,
  createIpcEndpoint
} from "../src/ipc-endpoint.js";

describe("VS Code IPC endpoint generation", () => {
  it("generates a high-entropy named pipe on Windows", async () => {
    const endpoint = await createIpcEndpoint({
      platform: "win32",
      randomBytesImpl: () => Buffer.alloc(16, 0xab)
    });

    assert.equal(endpoint.kind, "pipe");
    assert.match(
      endpoint.value,
      /^\\\\\.\\pipe\\attentive-vscode-[a-f0-9]{32}-sock$/
    );
  });

  it("prefers a secure XDG runtime directory and keeps the socket path bounded", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "attentive-runtime-"));
    try {
      await chmod(runtimeDirectory, 0o700);
      const endpoint = await createIpcEndpoint({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: runtimeDirectory },
        currentUid: () => process.getuid?.()
      });

      assert.equal(endpoint.kind, "socket");
      assert.equal(endpoint.privateDirectory, undefined);
      assert.equal(endpoint.value.startsWith(runtimeDirectory), true);
      assert.equal(
        Buffer.byteLength(endpoint.value, "utf8") <= MAX_UNIX_SOCKET_PATH_LENGTH,
        true
      );
      await cleanupIpcEndpoint(endpoint);
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  it("falls back to a private temporary directory when XDG runtime is insecure", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "attentive-runtime-"));
    const tempDirectory = await mkdtemp(join(tmpdir(), "attentive-temp-"));
    try {
      await chmod(runtimeDirectory, 0o755);
      const endpoint = await createIpcEndpoint({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: runtimeDirectory },
        tempDirectory: () => tempDirectory,
        currentUid: () => process.getuid?.()
      });

      assert.equal(endpoint.kind, "socket");
      assert.equal(endpoint.privateDirectory?.startsWith(tempDirectory), true);
      const directoryStats = await lstat(endpoint.privateDirectory ?? "");
      assert.equal(directoryStats.mode & 0o777, 0o700);
      await cleanupIpcEndpoint(endpoint);
      await assert.rejects(() => lstat(endpoint.privateDirectory ?? ""));
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true });
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it("creates different endpoints for different activations", async () => {
    const first = await createIpcEndpoint({ platform: "win32" });
    const second = await createIpcEndpoint({ platform: "win32" });
    assert.notEqual(first.value, second.value);
  });
});
