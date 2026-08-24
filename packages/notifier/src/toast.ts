import { spawn } from "node:child_process";
import notifier from "node-notifier";
import type { NotificationRequest } from "@attentive/protocol";

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

/**
 * Windows implementation kept behind the dispatcher boundary so the HTTP service remains
 * testable on non-Windows hosts.
 */
export function createWindowsToastDispatcher(): NotificationDispatcher {
  return (request, _notificationId) => {
    if (process.platform !== "win32") {
      return Promise.reject(new Error("Windows notifications require a Windows notifier host"));
    }

    let opened = false;
    const openRequestedUrl = () => {
      if (!request.url || opened) {
        return;
      }
      opened = true;
      openUrl(request.url);
    };

    try {
      const toast = toastNotifier.notify(
        {
          title: request.title,
          message: request.body,
          // `wait` lets node-notifier emit the activation event on Windows.
          wait: Boolean(request.url),
          // Windows SnoreToast ignores `open`, while other backends can use it directly.
          open: request.url
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

      if (request.url && toast && typeof toast.on === "function") {
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

function openUrl(url: string): void {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: process.platform === "win32"
  });
  child.unref();
}
