import type { Component } from '../../../types/cad';

export function isComponentVisible(
  components: Record<string, Component>,
  componentId: string | undefined,
): boolean {
  let currentId = componentId;
  const seen = new Set<string>();

  while (currentId) {
    if (seen.has(currentId)) return true;
    seen.add(currentId);

    const component = components[currentId];
    if (!component) return true;
    if (component.visible === false) return false;
    currentId = component.parentId ?? undefined;
  }

  return true;
}
