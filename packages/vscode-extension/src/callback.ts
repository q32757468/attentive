export const CALLBACK_ENVIRONMENT_VARIABLE = "ATTENTIVE_VSCODE_CALLBACK_URI";
export const CALLBACK_BASE_URI = "vscode://attentive.attentive-vscode/focus";
export const STATUS_COMMAND = "attentive.showCallbackStatus";

interface DisposableLike {
  dispose(): unknown;
}

interface UriLike {
  readonly path: string;
  readonly scheme: string;
  toString(): string;
}

interface EnvironmentVariableCollectionLike {
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
    registerUriHandler(handler: { handleUri(uri: UriLike): unknown }): DisposableLike;
    showInformationMessage(message: string): unknown;
  };
  readonly commands: {
    registerCommand(command: string, callback: () => unknown): DisposableLike;
  };
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
  vscode: CallbackVscodeApi
): Promise<() => void> {
  let injectedScheme: string | undefined;
  const collection = context.environmentVariableCollection;
  collection.persistent = false;

  context.subscriptions.push(
    vscode.window.registerUriHandler(createFocusUriHandler()),
    vscode.commands.registerCommand(STATUS_COMMAND, () => {
      const status = injectedScheme === undefined
        ? "Attentive callback is not injected."
        : `Attentive callback is injected (scheme: ${injectedScheme}).`;
      return vscode.window.showInformationMessage(status);
    })
  );

  const callbackUri = await vscode.env.asExternalUri(
    vscode.Uri.parse(CALLBACK_BASE_URI)
  );
  collection.replace(CALLBACK_ENVIRONMENT_VARIABLE, callbackUri.toString());
  injectedScheme = callbackUri.scheme;

  return () => collection.delete(CALLBACK_ENVIRONMENT_VARIABLE);
}
