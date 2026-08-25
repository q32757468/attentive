import {
  WINDOW_CONTEXT_ENDPOINT_ENVIRONMENT_VARIABLE,
  WINDOW_CONTEXT_VERSION,
  isOpenUri,
  type WindowContextResponse
} from "@attentive/protocol";
import type { IpcEndpointOptions } from "./ipc-endpoint.js";
import {
  startWindowContextServer,
  type WindowContextServer,
  type WindowContextServerOptions
} from "./window-context-server.js";

export const IPC_ENDPOINT_ENVIRONMENT_VARIABLE =
  WINDOW_CONTEXT_ENDPOINT_ENVIRONMENT_VARIABLE;
export const IPC_ENDPOINT_ENVIRONMENT_DESCRIPTION =
  "Provides Attentive with a local VS Code window context endpoint";
export const CALLBACK_BASE_URI = "vscode://attentive.attentive-vscode/focus";
export const STATUS_COMMAND = "attentive.showCallbackStatus";
const LEGACY_CALLBACK_ENVIRONMENT_VARIABLE = "ATTENTIVE_VSCODE_CALLBACK_URI";

interface DisposableLike {
  dispose(): unknown;
}

interface UriLike {
  readonly path: string;
  readonly scheme: string;
  toString(): string;
}

interface MarkdownStringLike {
  readonly value: string;
}

interface EnvironmentVariableCollectionLike {
  description?: string | MarkdownStringLike;
  persistent: boolean;
  replace(variable: string, value: string): void;
  delete(variable: string): void;
}

export interface CallbackExtensionContext {
  readonly environmentVariableCollection: EnvironmentVariableCollectionLike;
  readonly subscriptions: { push(...items: DisposableLike[]): unknown };
}

export interface CallbackVscodeApi {
  readonly Uri: { parse(value: string): UriLike };
  readonly env: { asExternalUri(uri: UriLike): PromiseLike<UriLike> };
  readonly window: {
    readonly state: { readonly focused: boolean };
    registerUriHandler(handler: { handleUri(uri: UriLike): unknown }): DisposableLike;
    showInformationMessage(message: string): unknown;
  };
  readonly commands: {
    registerCommand(command: string, callback: () => unknown): DisposableLike;
  };
}

export interface CallbackActivationOptions {
  endpointOptions?: IpcEndpointOptions;
  startServer?: (
    options: WindowContextServerOptions
  ) => Promise<WindowContextServer>;
  now?: () => Date;
}

interface CallbackDiagnosticState {
  server?: WindowContextServer;
  callbackScheme?: string;
  callbackAvailable: boolean;
  lastError?: { category: string; at: Date };
}

export function createFocusUriHandler(onFocus: () => void = () => undefined): {
  handleUri(uri: Pick<UriLike, "path">): void;
} {
  return {
    handleUri(uri) {
      if (uri.path === "/focus") {
        onFocus();
      }
    }
  };
}

export async function activateCallbackExtension(
  context: CallbackExtensionContext,
  vscode: CallbackVscodeApi,
  options: CallbackActivationOptions = {}
): Promise<void> {
  const collection = context.environmentVariableCollection;
  const now = options.now ?? (() => new Date());
  const diagnostic: CallbackDiagnosticState = {
    callbackAvailable: false
  };
  const reportError = (category: string): void => {
    diagnostic.lastError = { category, at: now() };
  };

  collection.persistent = false;
  collection.description = IPC_ENDPOINT_ENVIRONMENT_DESCRIPTION;
  // This deletion is intentional cleanup of the pre-IPC contribution. There
  // is no compatibility read or fallback for old terminal environments.
  collection.delete(LEGACY_CALLBACK_ENVIRONMENT_VARIABLE);
  collection.delete(IPC_ENDPOINT_ENVIRONMENT_VARIABLE);

  context.subscriptions.push(
    vscode.window.registerUriHandler(createFocusUriHandler()),
    vscode.commands.registerCommand(STATUS_COMMAND, () => {
      const status = formatDiagnosticStatus(diagnostic, vscode);
      return vscode.window.showInformationMessage(status);
    })
  );

  let callbackUri: string | undefined;
  try {
    const externalUri = await vscode.env.asExternalUri(
      vscode.Uri.parse(CALLBACK_BASE_URI)
    );
    const value = externalUri.toString();
    if (isOpenUri(value)) {
      callbackUri = value;
      diagnostic.callbackAvailable = true;
      diagnostic.callbackScheme = externalUri.scheme;
    } else {
      reportError("invalid-callback-uri");
    }
  } catch {
    reportError("callback-generation-failed");
  }

  const startServer = options.startServer ?? startWindowContextServer;
  try {
    const server = await startServer({
      endpointOptions: options.endpointOptions,
      getContext: () => {
        const contextValue: WindowContextResponse = {
          version: WINDOW_CONTEXT_VERSION,
          focused: vscode.window.state.focused
        };
        if (callbackUri !== undefined) {
          contextValue.callbackUri = callbackUri;
        }
        return contextValue;
      },
      onError: reportError
    });
    diagnostic.server = server;
    try {
      // startServer only resolves after the endpoint is listening and, for a
      // Unix socket, after its mode has been tightened to 0600.
      collection.replace(IPC_ENDPOINT_ENVIRONMENT_VARIABLE, server.endpoint.value);
      context.subscriptions.push({ dispose: () => server.dispose() });
    } catch {
      reportError("endpoint-contribution-failed");
      diagnostic.server = undefined;
      await server.dispose();
      collection.delete(IPC_ENDPOINT_ENVIRONMENT_VARIABLE);
    }
  } catch {
    reportError("server-start-failed");
    collection.delete(IPC_ENDPOINT_ENVIRONMENT_VARIABLE);
  }
}

function formatDiagnosticStatus(
  diagnostic: CallbackDiagnosticState,
  vscode: CallbackVscodeApi
): string {
  const server = diagnostic.server;
  const serverStatus = server?.isListening === true ? "listening" : "not listening";
  const endpointType = server?.endpoint.kind === "pipe"
    ? "named pipe"
    : server?.endpoint.kind === "socket"
      ? "Unix socket"
      : "none";
  const focusStatus = vscode.window.state.focused ? "focused" : "not focused";
  const callbackStatus = diagnostic.callbackAvailable
    ? `available (scheme: ${diagnostic.callbackScheme ?? "unknown"})`
    : "unavailable";
  const lastError = diagnostic.lastError === undefined
    ? "none"
    : `${diagnostic.lastError.category} at ${diagnostic.lastError.at.toISOString()}`;

  return [
    `Attentive integration: IPC ${serverStatus} (${endpointType});`,
    `window ${focusStatus};`,
    `callback ${callbackStatus};`,
    `last IPC error: ${lastError}.`
  ].join(" ");
}
