import { spawn } from "node:child_process";
import notifier from "node-notifier";
import type { NotificationRequest } from "@attentive-kit/protocol";

export type NotificationDispatcher = (
  request: NotificationRequest,
  notificationId: string
) => Promise<void> | void;

interface ToastNotification {
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface ToastNotifier {
  notify(
    options: Record<string, unknown>,
    callback?: (error: Error | null, response?: unknown, metadata?: unknown) => void
  ): ToastNotification;
}

const toastNotifier = notifier as unknown as ToastNotifier;

export interface WindowsToastDispatcherOptions {
  notifier?: ToastNotifier;
  openUri?: (uri: string) => void;
  platform?: NodeJS.Platform;
}

/**
 * Windows implementation kept behind the dispatcher boundary so the HTTP service remains
 * testable on non-Windows hosts.
 */
export function createWindowsToastDispatcher(
  options: WindowsToastDispatcherOptions = {}
): NotificationDispatcher {
  const activeNotifier = options.notifier ?? toastNotifier;
  const platform = options.platform ?? process.platform;
  const openUri = options.openUri ?? openUriWithExplorer;

  return (request, _notificationId) => {
    if (platform !== "win32") {
      return Promise.reject(new Error("Windows notifications require a Windows notifier host"));
    }

    let opened = false;
    const openRequestedUrl = () => {
      if (!request.action || opened) {
        return;
      }
      opened = true;
      openUri(request.action.uri);
    };

    try {
      const toast = activeNotifier.notify(
        {
          title: request.title,
          message: request.body,
          // `wait` lets node-notifier emit the activation event on Windows.
          wait: Boolean(request.action)
        },
        (error, _response, metadata) => {
          if (error) {
            console.error("Windows notification submission failed", error);
            return;
          }
          if (isClickMetadata(metadata)) {
            openRequestedUrl();
          }
        }
      );

      if (request.action && toast && typeof toast.on === "function") {
        toast.on("click", openRequestedUrl);
      }
    } catch (error: unknown) {
      return Promise.reject(error);
    }

    // The protocol defines success as submission to the OS notifier, not a user click.
    return Promise.resolve();
  };
}

function isClickMetadata(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    "activationType" in value && (value as { activationType?: unknown }).activationType === "click";
}

export function openUriWithExplorer(
  uri: string,
  spawnImpl: typeof spawn = spawn
): void {
  const child = spawnImpl("explorer.exe", [uri], {
    detached: true,
    stdio: "ignore",
    shell: false
  });
  child.unref();
}
