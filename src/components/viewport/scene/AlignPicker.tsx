/**
 * AlignPicker — viewport geometry picking for the Align dialog.
 *
 * Enabled only while the Align dialog is open and a pick stage is active.
 * Exactly one of face / edge / vertex pickers is enabled at a time (driven
 * by alignPickKind) so their capture-phase click listeners never conflict.
 */

import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { useFacePicker } from '../../../hooks/useFacePicker';
import { useEdgePicker } from '../../../hooks/useEdgePicker';
import { useVertexPicker } from '../../../hooks/useVertexPicker';
import type { AlignGeomPick } from '../../../types/cad';

function meshFeatureId(mesh: THREE.Mesh): string | null {
  const id = mesh.userData?.featureId;
  return typeof id === 'string' ? id : null;
}

export default function AlignPicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const alignPickStage = useCADStore((s) => s.alignPickStage);
  const alignPickKind = useCADStore((s) => s.alignPickKind);

  const active = activeDialog === 'align-dialog' && alignPickStage !== 'idle';

  const dispatchPick = (pick: AlignGeomPick) => {
    const s = useCADStore.getState();
    if (s.alignPickStage === 'source') {
      s.setAlignSource(pick);
      s.setAlignPickStage('target');
      s.setStatusMessage('Align: source set — now pick the target geometry');
    } else if (s.alignPickStage === 'target') {
      s.setAlignTarget(pick);
      s.setAlignPickStage('idle');
      s.setStatusMessage('Align: target set — adjust options and click OK');
    }
  };

  useFacePicker({
    enabled: active && alignPickKind === 'face',
    onClick: (r) => dispatchPick({
      featureId: meshFeatureId(r.mesh),
      kind: 'face',
      point: r.centroid.toArray() as [number, number, number],
      dir: r.normal.clone().normalize().toArray() as [number, number, number],
    }),
  });

  useEdgePicker({
    enabled: active && alignPickKind === 'edge',
    onClick: (r) => dispatchPick({
      featureId: meshFeatureId(r.mesh),
      kind: 'edge',
      point: r.midpoint.toArray() as [number, number, number],
      dir: r.direction.clone().normalize().toArray() as [number, number, number],
    }),
  });

  useVertexPicker({
    enabled: active && alignPickKind === 'vertex',
    onClick: (r) => dispatchPick({
      featureId: meshFeatureId(r.mesh),
      kind: 'vertex',
      point: r.position.toArray() as [number, number, number],
      dir: null,
    }),
  });

  return null;
}
