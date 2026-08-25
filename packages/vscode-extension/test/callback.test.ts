import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activateCallbackExtension,
  CALLBACK_BASE_URI,
  CALLBACK_ENVIRONMENT_VARIABLE,
  createFocusUriHandler,
  STATUS_COMMAND,
  type CallbackExtensionContext,
  type CallbackVscodeApi
} from "../src/callback.js";

describe("VS Code callback extension", () => {
  it("handles only the /focus callback path", () => {
    let focusCount = 0;
    const handler = createFocusUriHandler(() => focusCount += 1);

    handler.handleUri({ path: "/other" });
    handler.handleUri({ path: "/focus" });

    assert.equal(focusCount, 1);
  });

  it("generates and injects the complete external callback URI", async () => {
    const replacements: Array<[string, string]> = [];
    const deletions: string[] = [];
    const messages: string[] = [];
    let parsedUri = "";
    let registeredCommand = "";
    let statusCallback: (() => unknown) | undefined;
    const collection = {
      persistent: true,
      replace(name: string, value: string) { replacements.push([name, value]); },
      delete(name: string) { deletions.push(name); }
    };
    const context: CallbackExtensionContext = {
      environmentVariableCollection: collection,
      subscriptions: { push() { return 0; } }
    };
    const externalValue = "vscode://attentive.attentive-vscode/focus?windowId=opaque%26value";
    const api: CallbackVscodeApi = {
      Uri: {
        parse(value) {
          parsedUri = value;
          return { path: "/focus", scheme: "vscode", toString: () => value };
        }
      },
      env: {
        async asExternalUri() {
          return { path: "/focus", scheme: "vscode", toString: () => externalValue };
        }
      },
      window: {
        registerUriHandler() { return { dispose() {} }; },
        showInformationMessage(message) { messages.push(message); }
      },
      commands: {
        registerCommand(command, callback) {
          registeredCommand = command;
          statusCallback = callback;
          return { dispose() {} };
        }
      }
    };

    const cleanup = await activateCallbackExtension(context, api);

    assert.equal(parsedUri, CALLBACK_BASE_URI);
    assert.equal(collection.persistent, false);
    assert.deepEqual(replacements, [[CALLBACK_ENVIRONMENT_VARIABLE, externalValue]]);
    assert.equal(registeredCommand, STATUS_COMMAND);
    statusCallback?.();
    assert.deepEqual(messages, ["Attentive callback is injected (scheme: vscode)."]);
    assert.equal(messages[0].includes(externalValue), false);

    cleanup();
    assert.deepEqual(deletions, [CALLBACK_ENVIRONMENT_VARIABLE]);
  });
});
