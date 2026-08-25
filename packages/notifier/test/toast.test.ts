import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWindowsToastDispatcher, openUriWithExplorer } from "../src/toast.js";

describe("Windows toast actions", () => {
  it("opens an action at most once when both click signals fire", async () => {
    let callback: ((error: Error | null, response?: unknown, metadata?: unknown) => void) | undefined;
    let click: (() => void) | undefined;
    const opened: string[] = [];
    const dispatcher = createWindowsToastDispatcher({
      platform: "win32",
      notifier: {
        notify(_options, registeredCallback) {
          callback = registeredCallback;
          return {
            on(event, listener) {
              if (event === "click") click = listener as () => void;
            }
          };
        }
      },
      openUri: (uri) => opened.push(uri)
    });

    await dispatcher({
      title: "Build",
      body: "Done",
      action: { type: "open-uri", uri: "vscode://attentive.attentive-vscode/focus" }
    }, "notification-1");
    callback?.(null, undefined, { activationType: "click" });
    click?.();

    assert.deepEqual(opened, ["vscode://attentive.attentive-vscode/focus"]);
  });

  it("uses explorer.exe with an argument array and no shell", () => {
    let invocation: { command: string; args: readonly string[]; options: Record<string, unknown> } | undefined;
    const fakeSpawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
      invocation = { command, args, options };
      return { unref() {} };
    }) as never;

    openUriWithExplorer("vscode://attentive.attentive-vscode/focus?a=1&b=2", fakeSpawn);

    assert.equal(invocation?.command, "explorer.exe");
    assert.deepEqual(invocation?.args, ["vscode://attentive.attentive-vscode/focus?a=1&b=2"]);
    assert.equal(invocation?.options.shell, false);
  });
});
