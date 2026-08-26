import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activateCallbackExtension,
  CALLBACK_BASE_URI,
  IPC_ENDPOINT_ENVIRONMENT_DESCRIPTION,
  IPC_ENDPOINT_ENVIRONMENT_VARIABLE,
  createFocusUriHandler,
  STATUS_COMMAND,
  type CallbackExtensionContext,
  type CallbackVscodeApi
} from "../src/callback.js";
import type {
  WindowContextServer,
  WindowContextServerOptions
} from "../src/window-context-server.js";

describe("VS Code window context extension", () => {
  it("uses the extension manifest ID as the callback authority", () => {
    const manifest = JSON.parse(
      readFileSync("package.json", "utf8")
    ) as { name: string; publisher: string };

    assert.equal(
      new URL(CALLBACK_BASE_URI).host,
      `${manifest.publisher}.${manifest.name}`
    );
  });

  it("handles only the /focus callback path", () => {
    let focusCount = 0;
    const handler = createFocusUriHandler(() => focusCount += 1);

    handler.handleUri({ path: "/other" });
    handler.handleUri({ path: "/focus" });

    assert.equal(focusCount, 1);
  });

  it("contributes the IPC endpoint only after the server is listening", async () => {
    const replacements: Array<[string, string]> = [];
    const deletions: string[] = [];
    const messages: string[] = [];
    const subscriptions: Array<{ dispose(): unknown }> = [];
    let parsedUri = "";
    let registeredCommand = "";
    let statusCallback: (() => unknown) | undefined;
    let focused = false;
    let capturedOptions: WindowContextServerOptions | undefined;
    let releaseStart: ((server: WindowContextServer) => void) | undefined;
    const startPromise = new Promise<WindowContextServer>((resolve) => {
      releaseStart = resolve;
    });
    const collection = {
      description: undefined as string | undefined,
      persistent: true,
      replace(name: string, value: string) { replacements.push([name, value]); },
      get() { return undefined; },
      delete(name: string) { deletions.push(name); }
    };
    const context: CallbackExtensionContext = {
      environmentVariableCollection: collection,
      subscriptions: { push(...items) { subscriptions.push(...items); } }
    };
    const externalValue = "vscode://32757468.attentive-vscode/focus?windowId=opaque%26value";
    const api = createApi({
      focused: () => focused,
      parsedUri: (value) => parsedUri = value,
      externalValue,
      messages,
      registerCommand: (command, callback) => {
        registeredCommand = command;
        statusCallback = callback;
      }
    });

    const activation = activateCallbackExtension(context, api, {
      startServer: async (options) => {
        capturedOptions = options;
        return startPromise;
      },
      now: () => new Date("2026-08-25T00:00:00.000Z")
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(replacements, []);

    const server = fakeServer("/tmp/attentive-window.sock");
    releaseStart?.(server);
    await activation;

    assert.equal(parsedUri, CALLBACK_BASE_URI);
    assert.equal(collection.persistent, true);
    assert.equal(collection.description, IPC_ENDPOINT_ENVIRONMENT_DESCRIPTION);
    assert.deepEqual(replacements, [[IPC_ENDPOINT_ENVIRONMENT_VARIABLE, "/tmp/attentive-window.sock"]]);
    assert.deepEqual(deletions, [
      "ATTENTIVE_VSCODE_CALLBACK_URI"
    ]);
    assert.equal(registeredCommand, STATUS_COMMAND);

    focused = true;
    assert.deepEqual(capturedOptions?.getContext(), {
      version: 1,
      focused: true,
      callbackUri: externalValue
    });
    statusCallback?.();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].includes("/tmp/attentive-window.sock"), false);
    assert.equal(messages[0].includes(externalValue), false);
    assert.match(messages[0], /IPC listening/);
    assert.match(messages[0], /callback available/);

    for (const subscription of subscriptions) {
      await subscription.dispose();
    }
  });

  it("reads focused state for every IPC request", async () => {
    let focused = false;
    let serverOptions: WindowContextServerOptions | undefined;
    const server = fakeServer("/tmp/attentive-window.sock");
    const setup = createTestSetup(() => focused, "vscode://32757468.attentive-vscode/focus?window=two");
    await activateCallbackExtension(setup.context, setup.api, {
      startServer: async (options) => {
        serverOptions = options;
        return server;
      }
    });

    assert.equal(serverOptions?.getContext().focused, false);
    focused = true;
    assert.equal(serverOptions?.getContext().focused, true);
    await setup.dispose();
  });

  it("reuses a persisted endpoint after an Extension Host reload", async () => {
    const persisted = "\\\\.\\pipe\\attentive-vscode-0123456789abcdef0123456789abcdef-sock";
    const setup = createTestSetup(
      () => false,
      "vscode://32757468.attentive-vscode/focus?window=reloaded",
      persisted
    );
    let capturedEndpoint: WindowContextServerOptions["endpoint"];
    await activateCallbackExtension(setup.context, setup.api, {
      endpointOptions: { platform: "win32" },
      startServer: async (options) => {
        capturedEndpoint = options.endpoint;
        return fakeServer(persisted);
      }
    });

    assert.deepEqual(capturedEndpoint, { kind: "pipe", value: persisted });
    assert.deepEqual(setup.replacements, [[IPC_ENDPOINT_ENVIRONMENT_VARIABLE, persisted]]);
    await setup.dispose();
  });

  it("falls back to a new endpoint when the persisted endpoint cannot listen", async () => {
    const persisted = "\\\\.\\pipe\\attentive-vscode-0123456789abcdef0123456789abcdef-sock";
    const replacement = "\\\\.\\pipe\\attentive-vscode-fedcba9876543210fedcba9876543210-sock";
    const setup = createTestSetup(
      () => false,
      "vscode://32757468.attentive-vscode/focus?window=fallback",
      persisted
    );
    const attemptedEndpoints: Array<WindowContextServerOptions["endpoint"]> = [];
    await activateCallbackExtension(setup.context, setup.api, {
      endpointOptions: { platform: "win32" },
      startServer: async (options) => {
        attemptedEndpoints.push(options.endpoint);
        if (options.endpoint !== undefined) {
          throw new Error("endpoint is already in use");
        }
        return fakeServer(replacement);
      }
    });

    assert.deepEqual(attemptedEndpoints, [
      { kind: "pipe", value: persisted },
      undefined
    ]);
    assert.deepEqual(setup.replacements, [[IPC_ENDPOINT_ENVIRONMENT_VARIABLE, replacement]]);
    await setup.dispose();
  });

  it("keeps the handler usable when callback generation or server startup fails", async () => {
    const setup = createTestSetup(() => false, "not a URI");
    let capturedContext: (() => unknown) | undefined;
    await activateCallbackExtension(setup.context, setup.api, {
      startServer: async (options) => {
        capturedContext = options.getContext;
        throw new Error("server unavailable");
      }
    });

    assert.deepEqual(capturedContext?.(), { version: 1, focused: false });
    assert.deepEqual(setup.replacements, []);
    setup.statusCallback?.();
    assert.match(setup.messages[0] ?? "", /callback unavailable/);
    assert.equal(setup.messages[0]?.includes("not a URI"), false);
    await setup.dispose();
  });
});

function fakeServer(value: string): WindowContextServer {
  return {
    endpoint: { kind: "socket", value },
    isListening: true,
    async dispose() {}
  };
}

function createApi(options: {
  focused: () => boolean;
  parsedUri: (value: string) => void;
  externalValue: string;
  messages: string[];
  registerCommand: (command: string, callback: () => unknown) => void;
}): CallbackVscodeApi {
  return {
    Uri: {
      parse(value) {
        options.parsedUri(value);
        return { path: "/focus", scheme: "vscode", toString: () => value };
      }
    },
    env: {
      async asExternalUri() {
        return { path: "/focus", scheme: "vscode", toString: () => options.externalValue };
      }
    },
    window: {
      get state() {
        return { focused: options.focused() };
      },
      registerUriHandler() { return { dispose() {} }; },
      showInformationMessage(message) { options.messages.push(message); }
    },
    commands: {
      registerCommand(command, callback) {
        options.registerCommand(command, callback);
        return { dispose() {} };
      }
    }
  };
}

function createTestSetup(
  focused: () => boolean,
  externalValue: string,
  persistedEndpoint?: string
) {
  const replacements: Array<[string, string]> = [];
  const messages: string[] = [];
  const subscriptions: Array<{ dispose(): unknown }> = [];
  let statusCallback: (() => unknown) | undefined;
  const collection = {
    description: undefined as string | undefined,
    persistent: true,
    replace(name: string, value: string) { replacements.push([name, value]); },
    get(name: string) {
      return name === IPC_ENDPOINT_ENVIRONMENT_VARIABLE && persistedEndpoint !== undefined
        ? { value: persistedEndpoint }
        : undefined;
    },
    delete() {}
  };
  const context: CallbackExtensionContext = {
    environmentVariableCollection: collection,
    subscriptions: { push(...items) { subscriptions.push(...items); } }
  };
  const api = createApi({
    focused,
    parsedUri: () => undefined,
    externalValue,
    messages,
    registerCommand: (_command, callback) => { statusCallback = callback; }
  });
  return {
    context,
    api,
    replacements,
    messages,
    get statusCallback() { return statusCallback; },
    async dispose() {
      for (const subscription of subscriptions) {
        await subscription.dispose();
      }
    }
  };
}
