import * as vscode from "vscode";
import { activateCallbackExtension } from "./callback.js";

let cleanup: (() => void) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  cleanup = await activateCallbackExtension(context, vscode);
}

export function deactivate(): void {
  cleanup?.();
  cleanup = undefined;
}
