import type { Feature } from '../../../types/cad';

const FEATURE_DIALOG_MAP: Record<string, string | null> = {
  shell: 'shell',
  draft: 'draft',
  scale: 'scale',
  combine: 'combine',
  fillet: 'fillet',
  hole: 'hole',
  thread: 'thread',
  thicken: 'thicken',
  'linear-pattern': 'linear-pattern',
  'circular-pattern': 'circular-pattern',
  'rectangular-pattern': 'rectangular-pattern',
  'pattern-on-path': 'pattern-on-path',
  mirror: 'mirror',
  'offset-face': 'offset-face',
  emboss: 'emboss',
  pipe: 'pipe',
  coil: 'coil',
  'boundary-fill': 'boundary-fill',
  'construction-plane': 'construction-plane',
  'construction-axis': 'axis-perp-to-face',
};

export function editDialogFor(feature: Feature): string | null {
  const p = feature.params ?? {};
  const direct = FEATURE_DIALOG_MAP[feature.type];
  if (direct !== undefined) return direct;

  switch (feature.type) {
    case 'split-body':
      if (p.isSurfaceTrim) return 'surface-trim';
      if (p.isSurfaceSplit) return 'surface-split';
      if (p.unstitch) return 'unstitch';
      return 'split';
    case 'rib':
      if (p.webStyle === 'perpendicular') return 'web';
      if (p.restStyle === 'rest') return 'rest';
      return null;
    case 'primitive': {
      const kind = String(p.kind ?? '');
      if (kind && ['box', 'cylinder', 'sphere', 'torus', 'coil'].includes(kind)) {
        return `primitive-${kind}`;
      }
      return null;
    }
    case 'import':
      if (p.isRigidGroup) return 'rigid-group';
      if (p.isPhysicalMaterial) return 'physical-material';
      if (p.isAppearance) return 'appearance';
      if (p.isMoveBody) return 'move-body';
      if (p.baseFeature) return 'base-feature';
      if (p.isCanvasRef) return 'insert-canvas';
      return null;
    case 'sweep':
      if (p.isSurfaceOffset) return 'offset-surface';
      if (p.isSurfaceExtend) return 'surface-extend';
      return 'sweep';
    default:
      return null;
  }
}
