export class DuetEventBus {
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event: string, data: unknown): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    for (const callback of callbacks) {
      try {
        callback(data);
      } catch {
        // Listener errors must not break the service.
      }
    }
  }
}
