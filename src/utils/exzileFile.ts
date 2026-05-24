/**
 * OCC-7.4 — .exzile file format (schema v2 with BRep bodies).
 *
 * v1: mesh blobs (legacy, not yet in prod — but we start at v2 with STEP)
 * v2: BRepBody shapes as STEP strings; features are serialized params only
 *     (no BufferGeometry). Backward compat: v1 files load and get migrated on
 *     first save by re-creating from the feature tree.
 *
 * The file is JSON-encoded and may be gzip-compressed (.exzile = gzip JSON).
 */
import type { Feature, Sketch } from '../types/cad';
import { captureOccSnapshot, restoreOccSnapshot, type OccBodySnapshot } from '../engine/occ/occSnapshot';
import { serializeFeature, deserializeFeature, deserializeSketch } from '../store/cad/persistence';

// ── Schema ────────────────────────────────────────────────────────────────────

export interface ExzileFileV2 {
  version: 2;
  savedAt: string;
  features: unknown[];
  sketches: unknown[];
  featureGroups: unknown[];
  designConfigurations: unknown[];
  activeDesignConfigurationId?: string;
  /** STEP-serialized BRepBodies (one per feature that has an OCC body). */
  bodies: OccBodySnapshot[];
}

// ── Write ─────────────────────────────────────────────────────────────────────

export interface ExzileWriteInput {
  features: Feature[];
  sketches: Sketch[];
  featureGroups: unknown[];
  designConfigurations: unknown[];
  activeDesignConfigurationId?: string;
}

export function serializeExzileFile(input: ExzileWriteInput): string {
  const bodies = captureOccSnapshot();

  const file: ExzileFileV2 = {
    version: 2,
    savedAt: new Date().toISOString(),
    features: input.features.map((f) => serializeFeature(f)),
    sketches: input.sketches.map((s) => ({
      ...s,
      planeNormal: s.planeNormal ? [s.planeNormal.x, s.planeNormal.y, s.planeNormal.z] : null,
      planeOrigin: s.planeOrigin ? [s.planeOrigin.x, s.planeOrigin.y, s.planeOrigin.z] : null,
    })),
    featureGroups: input.featureGroups,
    designConfigurations: input.designConfigurations,
    activeDesignConfigurationId: input.activeDesignConfigurationId,
    bodies,
  };

  return JSON.stringify(file);
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface ExzileReadResult {
  features: Feature[];
  sketches: Sketch[];
  featureGroups: unknown[];
  designConfigurations: unknown[];
  activeDesignConfigurationId?: string;
  version: number;
}

export async function deserializeExzileFile(json: string): Promise<ExzileReadResult> {
  const parsed = JSON.parse(json) as Partial<ExzileFileV2> & { version?: number };
  const version = parsed.version ?? 1;

  if (!Array.isArray(parsed.features)) {
    throw new Error('[exzileFile] missing features array');
  }

  // Restore OCC bodies if present (v2+)
  if (version >= 2 && Array.isArray(parsed.bodies) && parsed.bodies.length > 0) {
    await restoreOccSnapshot(parsed.bodies as OccBodySnapshot[]);
  }

  return {
    version,
    features: (parsed.features as Feature[]).map((f) => deserializeFeature(f)),
    sketches: Array.isArray(parsed.sketches)
      ? (parsed.sketches as Sketch[]).map((s) => deserializeSketch(s))
      : [],
    featureGroups: Array.isArray(parsed.featureGroups) ? parsed.featureGroups : [],
    designConfigurations: Array.isArray(parsed.designConfigurations) ? parsed.designConfigurations : [],
    activeDesignConfigurationId: parsed.activeDesignConfigurationId,
  };
}
