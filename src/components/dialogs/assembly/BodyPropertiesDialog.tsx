import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { DialogShell } from '../common/DialogShell';
import { useComponentStore } from '../../../store/componentStore';
import { useCADStore } from '../../../store/cadStore';
import { getOccSync } from '../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../engine/occ/globalRegistry';
import { occComputeBodyProperties } from '../../../engine/occ/ops/properties';
import type { OccBodyProperties } from '../../../engine/occ/ops/properties';
import './BodyPropertiesDialog.css';

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bp-row">
      <span className="bp-row__label">{label}</span>
      <span className="bp-row__value">{value}</span>
    </div>
  );
}

export function BodyPropertiesDialog({ onClose, bodyId }: { onClose: () => void; bodyId?: string }) {
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);
  const bodies = useComponentStore((s) => s.bodies);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const resolvedId = bodyId ?? selectedBodyId ?? '';
  const body = bodies[resolvedId];

  const [occProps, setOccProps] = useState<OccBodyProperties | null>(null);
  const [occError, setOccError] = useState(false);
  const [bbox, setBbox] = useState<THREE.Box3 | null>(null);
  const [triangleCount, setTriangleCount] = useState<number | null>(null);

  useEffect(() => {
    if (!body) return;

    // Mesh stats from THREE (synchronous)
    const mesh = body.mesh;
    if (mesh instanceof THREE.Mesh && mesh.geometry) {
      const geom = mesh.geometry;
      geom.computeBoundingBox();
      setBbox(geom.boundingBox?.clone() ?? null);
      const idx = geom.index;
      if (idx) {
        setTriangleCount(idx.count / 3);
      } else {
        const pos = geom.attributes['position'];
        if (pos) setTriangleCount(pos.count / 3);
      }
    }

    // OCC mass properties (synchronous if OCC loaded)
    const brepBodyId = mesh instanceof THREE.Mesh
      ? (mesh.userData['brepBodyId'] as string | undefined)
      : undefined;

    if (brepBodyId) {
      const occ = getOccSync();
      if (occ) {
        const brepBody = globalBRepBodyRegistry.get(brepBodyId);
        if (brepBody) {
          const props = occComputeBodyProperties(occ.oc, brepBody);
          if (props) {
            setOccProps(props);
          } else {
            setOccError(true);
          }
        }
      }
    }
  }, [body]);

  if (!body) {
    return (
      <DialogShell title="Properties" onClose={onClose} cancelLabel="Close">
        <div className="bp-empty">No body selected.</div>
      </DialogShell>
    );
  }

  const size = bbox
    ? new THREE.Vector3(
        bbox.max.x - bbox.min.x,
        bbox.max.y - bbox.min.y,
        bbox.max.z - bbox.min.z,
      )
    : null;

  return (
    <DialogShell title="Properties" onClose={onClose} cancelLabel="Close">
      <div className="bp-section-title">Body</div>

      <Row label="Name" value={body.name} />
      <Row label="Kind" value={body.bodyKind ?? 'mesh'} />
      {triangleCount != null && (
        <Row label="Triangles" value={fmt(triangleCount, 0)} />
      )}

      {size && (
        <>
          <div className="bp-section-title" style={{ marginTop: 10 }}>Bounding Box</div>
          <Row label="Width (X)" value={`${fmt(size.x)} mm`} />
          <Row label="Depth (Y)" value={`${fmt(size.y)} mm`} />
          <Row label="Height (Z)" value={`${fmt(size.z)} mm`} />
        </>
      )}

      {occProps && (
        <>
          <div className="bp-section-title" style={{ marginTop: 10 }}>Mass Properties</div>
          <Row label="Volume" value={`${fmt(occProps.volume)} mm³`} />
          <Row label="Surface Area" value={`${fmt(occProps.surfaceArea)} mm²`} />
          <Row
            label="Centre of Mass"
            value={
              `(${fmt(occProps.centreOfMass[0])}, ` +
              `${fmt(occProps.centreOfMass[1])}, ` +
              `${fmt(occProps.centreOfMass[2])}) mm`
            }
          />
        </>
      )}

      {occError && (
        <div className="bp-note">OCC properties unavailable for this body.</div>
      )}

      {!occProps && !occError && (
        <div className="bp-note">OCC not loaded — mass properties unavailable.</div>
      )}

      <div className="bp-section-title" style={{ marginTop: 10 }}>Appearance</div>
      <Row
        label="Colour"
        value={
          <span
            className="bp-color-swatch"
            style={{ background: body.material.color ?? '#888' }}
            title={body.material.color ?? 'default'}
          />
        }
      />
      <Row label="Opacity" value={`${Math.round((body.opacity ?? 1) * 100)}%`} />

      <div style={{ marginTop: 12 }}>
        <button
          className="btn btn-secondary"
          onClick={() => {
            if (occProps) {
              const text =
                `Body: ${body.name}\n` +
                `Volume: ${fmt(occProps.volume)} mm³\n` +
                `Surface Area: ${fmt(occProps.surfaceArea)} mm²\n` +
                `Centre of Mass: (${occProps.centreOfMass.map((v) => fmt(v)).join(', ')}) mm`;
              navigator.clipboard.writeText(text).then(() =>
                setStatusMessage('Properties copied to clipboard'),
              );
            }
          }}
          disabled={!occProps}
          title="Copy mass properties to clipboard"
        >
          Copy to Clipboard
        </button>
      </div>
    </DialogShell>
  );
}
