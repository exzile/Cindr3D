const QUEUE_KEY = 'dzign3d-print-queue';

export function loadQueue(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

export function saveQueue(queue: string[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch { /* ignore */ }
}

export function addToQueue(filePath: string): void {
  const queue = loadQueue();
  if (!queue.includes(filePath)) {
    queue.push(filePath);
    saveQueue(queue);
  }
  window.dispatchEvent(new Event('print-queue-changed'));
}
