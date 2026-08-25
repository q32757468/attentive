import * as vscode from "vscode";
import { activateCallbackExtension } from "./callback.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateCallbackExtension(context, vscode);
}
