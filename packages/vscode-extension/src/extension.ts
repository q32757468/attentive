import * as vscode from "vscode";
import { activateCallbackExtension } from "./callback.js";

let disposeActivation: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activation = await activateCallbackExtension(context, vscode);
  disposeActivation = () => activation.dispose();
}

export async function deactivate(): Promise<void> {
  const dispose = disposeActivation;
  disposeActivation = undefined;
  await dispose?.();
}
