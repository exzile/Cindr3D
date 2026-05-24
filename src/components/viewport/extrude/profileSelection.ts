import type { Feature, Sketch } from '../../../types/cad';
import { GeometryEngine } from '../../../engine/GeometryEngine';

export type ExtrudeProfileOption = {
  id: string;
  label: string;
  sketchId: string;
};

export function sketchProfileSelectionId(sketchId: string, profileIndex: number): string {
  return `${sketchId}::${profileIndex}`;
}

export function getExtrudeProfileUsage(
  features: Feature[],
  editingFeatureId: string | null | undefined,
): {
  fullyUsedSketchIds: Set<string>;
  consumedProfileIds: Set<string>;
} {
  const fullyUsedSketchIds = new Set<string>();
  const consumedProfileIds = new Set<string>();

  for (const feature of features) {
    if (feature.type !== 'extrude' || feature.suppressed || feature.id === editingFeatureId) continue;
    const sketchId = feature.sketchId?.split('::')[0];
    if (!sketchId) continue;

    const profileIndices = Array.isArray(feature.params.profileIndices)
      ? (feature.params.profileIndices as unknown[])
      : null;
    if (profileIndices?.length) {
      for (const rawIndex of profileIndices) {
        const profileIndex = Number(rawIndex);
        if (Number.isFinite(profileIndex)) {
          consumedProfileIds.add(sketchProfileSelectionId(sketchId, profileIndex));
        }
      }
      continue;
    }

    const profileIndex = feature.params.profileIndex;
    if (typeof profileIndex === 'number' && Number.isFinite(profileIndex)) {
      consumedProfileIds.add(sketchProfileSelectionId(sketchId, profileIndex));
    } else {
      fullyUsedSketchIds.add(sketchId);
    }
  }

  return { fullyUsedSketchIds, consumedProfileIds };
}

export function getExtrudeProfileOptions({
  extrudable,
  sketches,
  selectedIds,
  timelineSketchNames,
  consumedProfileIds,
}: {
  extrudable: Sketch[];
  sketches: Sketch[];
  selectedIds: string[];
  timelineSketchNames: Map<string, string>;
  consumedProfileIds: Set<string>;
}): ExtrudeProfileOption[] {
  const activeSketchIds = new Set(selectedIds.map((id) => id.split('::')[0]));
  const allRelevant = [
    ...extrudable,
    ...sketches.filter((sketch) => activeSketchIds.has(sketch.id) && !extrudable.includes(sketch)),
  ];
  const selectedIdSet = new Set(selectedIds);

  const options: ExtrudeProfileOption[] = allRelevant.flatMap((sketch) => {
    const count = GeometryEngine.sketchToProfileShapesFlat(sketch).length;
    return Array.from({ length: count }, (_, profileIndex) => ({
      id: sketchProfileSelectionId(sketch.id, profileIndex),
      label: `${timelineSketchNames.get(sketch.id) ?? sketch.name} - Profile ${profileIndex + 1}`,
      sketchId: sketch.id,
      profileIndex,
    })).filter(({ id, profileIndex }) =>
      (selectedIdSet.has(id) || !consumedProfileIds.has(id)) &&
      GeometryEngine.createProfileSketch(sketch, profileIndex) !== null
    );
  });

  for (const id of selectedIds) {
    if (id.includes('::')) continue;
    if (options.some((option) => option.id === id)) continue;
    const sketch = sketches.find((item) => item.id === id);
    if (sketch && timelineSketchNames.has(sketch.id)) {
      options.push({ id, label: timelineSketchNames.get(sketch.id) ?? sketch.name, sketchId: id });
    }
  }

  return options;
}
