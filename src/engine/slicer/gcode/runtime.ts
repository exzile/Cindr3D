import type { SliceProgress } from '../../../types/slicer';

export function resolveGCodeTemplate(
  template: string,
  vars: Record<string, number>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

export function reportProgress(
  callback: ((progress: SliceProgress) => void) | undefined,
  stage: SliceProgress['stage'],
  percent: number,
  currentLayer: number,
  totalLayers: number,
  message: string,
): void {
  if (callback) {
    callback({
      stage,
      percent,
      currentLayer,
      totalLayers,
      message,
    });
  }
}

export async function yieldToUI(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
