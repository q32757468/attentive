declare module "node-notifier" {
  interface Notification {
    on(event: string, listener: (...args: unknown[]) => void): Notification;
  }

  interface NodeNotifier {
    notify(
      options: Record<string, unknown>,
      callback?: (error: Error | null, response?: unknown, metadata?: unknown) => void
    ): Notification;
  }

  const notifier: NodeNotifier;
  export default notifier;
}
