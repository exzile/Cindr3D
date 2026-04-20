// Feature types that don't produce physical bodies and should not appear in
// "Add to plate" pickers inside the slicer workspace.
export const NON_BODY_FEATURE_TYPES = new Set<string>([
  'sketch',
  'construction-plane',
  'construction-axis',
  'isoparametric',
  'decal',
  'thread',
  'joint',
  'joint-origin',
  'contact-set',
  'rigid-group',
  'motion-link',
]);
