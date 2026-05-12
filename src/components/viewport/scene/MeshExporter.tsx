/**
 * MeshExporter — R3F component (lives inside <Canvas>).
 *
 * Watches for the `exportBodyId` + `exportBodyFormat` trigger in cadStore.
 * When set, it walks the scene, collects all meshes with matching
 * `userData.bodyId`, merges their geometries, and exports to STL or GLB.
 * After export, clears the trigger.
 *
 * CTX-8: Save As Mesh
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';

function collectBodyMeshes(root: THREE.Object3D, bodyId: string): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.bodyId === bodyId) {
      result.push(obj);
    }
  });
  return result;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MeshExporter() {
  const { scene } = useThree();
  const exportBodyId     = useCADStore((s) => s.exportBodyId);
  const exportBodyFormat = useCADStore((s) => s.exportBodyFormat);
  const clearBodyExport  = useCADStore((s) => s.clearBodyExport);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  useEffect(() => {
    if (!exportBodyId || !exportBodyFormat) return;

    // Read bodies imperatively to avoid stale closure on reactive `bodies` value
    const bodies = useComponentStore.getState().bodies;

    const meshes = collectBodyMeshes(scene, exportBodyId);

    if (meshes.length === 0) {
      setStatusMessage('Export failed: no mesh found for this body');
      clearBodyExport();
      return;
    }

    // Clone meshes so we don't mutate the scene; apply world transform for export
    const clones: THREE.Mesh[] = meshes.map((m) => {
      const clone = m.clone(false);
      clone.geometry = m.geometry.clone();
      clone.geometry.applyMatrix4(m.matrixWorld);
      return clone;
    });

    const bodyName = bodies[exportBodyId]?.name ?? `body_${exportBodyId.slice(0, 6)}`;
    const safeFilename = bodyName.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim() || 'body';

    const group = new THREE.Group();
    clones.forEach((c) => group.add(c));

    if (exportBodyFormat === 'stl') {
      const exporter = new STLExporter();
      const stlString = exporter.parse(group);
      const blob = new Blob([stlString], { type: 'text/plain' });
      downloadBlob(blob, `${safeFilename}.stl`);
      setStatusMessage(`Exported "${bodyName}" as STL`);
      // STLExporter is synchronous — safe to dispose immediately
      clones.forEach((c) => c.geometry.dispose());
      clearBodyExport();
    } else {
      // GLTFExporter is async — dispose inside callbacks to avoid use-after-free
      const exporter = new GLTFExporter();
      exporter.parse(
        group,
        (result) => {
          const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
          downloadBlob(blob, `${safeFilename}.glb`);
          setStatusMessage(`Exported "${bodyName}" as GLB`);
          clones.forEach((c) => c.geometry.dispose());
          clearBodyExport();
        },
        (error) => {
          setStatusMessage('Export failed: GLB error');
          clones.forEach((c) => c.geometry.dispose());
          clearBodyExport();
        },
        { binary: true },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportBodyId, exportBodyFormat]);

  return null;
}
