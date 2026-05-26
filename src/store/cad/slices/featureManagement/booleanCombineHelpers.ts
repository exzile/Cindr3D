import type { Feature } from "../../../../types/cad";

export function getBooleanParentIds(feature: Feature): string[] {
  const fromArray = feature.params.booleanParentIds;
  if (Array.isArray(fromArray))
    return fromArray.filter((id): id is string => typeof id === "string");
  return [feature.params.targetId, feature.params.toolId].filter(
    (id): id is string => typeof id === "string",
  );
}

export function keepsParentsHidden(feature: Feature): boolean {
  return feature.type === "combine" && feature.params.keepTools === false;
}

export function parentIsHiddenByAnotherCombine(
  features: Feature[],
  parentId: string,
  excludeCombineId: string,
): boolean {
  return features.some(
    (feature) =>
      feature.id !== excludeCombineId &&
      keepsParentsHidden(feature) &&
      getBooleanParentIds(feature).includes(parentId),
  );
}
