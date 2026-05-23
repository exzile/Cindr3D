import * as THREE from "three";
import {
  clusterEdgesByEndpointConnectivity,
  computePositionEps,
  fitEdgeCircle,
  fitEdgeCircleOrArc,
  parseEdgeIds,
  type PickedEdge,
} from "../../../../utils/geometry/edgeCutCore";
import { liveBodyMeshes } from "../../../../store/meshRegistry";

export type EdgeOpPreviewToolType = "fillet" | "chamfer";

export interface ParsedPreviewEdges {
  parsed: NonNullable<ReturnType<typeof parseEdgeIds>>;
  liveMesh: THREE.Mesh;
  previewEdges: PickedEdge[];
}

const MAX_NON_CIRCLE_SEGS = 6;

export function resolvePreviewEdges(
  enabled: boolean,
  edgeIds: string[],
  toolType: EdgeOpPreviewToolType,
): ParsedPreviewEdges | null {
  if (!enabled || edgeIds.length === 0) return null;
  const parsed = parseEdgeIds(edgeIds);
  if (!parsed) return null;
  const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
  if (!liveMesh) return null;

  const clusterEps = computePositionEps(liveMesh.geometry);
  const edgeClusters = clusterEdgesByEndpointConnectivity(
    parsed.edges,
    clusterEps,
  );
  const previewEdges: PickedEdge[] = [];
  for (const cluster of edgeClusters) {
    const circleFit =
      toolType === "fillet"
        ? fitEdgeCircleOrArc(cluster)
        : fitEdgeCircle(cluster);
    if (cluster.length <= MAX_NON_CIRCLE_SEGS || circleFit !== null) {
      previewEdges.push(...cluster);
    } else {
      for (let i = 0; i < MAX_NON_CIRCLE_SEGS; i++) {
        previewEdges.push(
          cluster[
            Math.round((i * (cluster.length - 1)) / (MAX_NON_CIRCLE_SEGS - 1))
          ],
        );
      }
    }
  }
  return { parsed, liveMesh, previewEdges };
}
