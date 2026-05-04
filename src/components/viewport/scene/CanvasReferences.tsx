import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

type CanvasReference = {
  id: string;
  dataUrl: string;
  plane: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  opacity: number;
};

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function transformForPlane(ref: CanvasReference): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const offsetX = finiteOr(ref.offsetX, 0);
  const offsetY = finiteOr(ref.offsetY, 0);

  switch (ref.plane) {
    case 'XZ':
      return {
        position: [offsetX, 0, offsetY],
        rotation: [-Math.PI / 2, 0, 0],
      };
    case 'YZ':
      return {
        position: [0, offsetX, offsetY],
        rotation: [0, Math.PI / 2, 0],
      };
    case 'XY':
    default:
      return {
        position: [offsetX, offsetY, 0],
        rotation: [0, 0, 0],
      };
  }
}

function CanvasReferenceImage({ refImage }: { refImage: CanvasReference }) {
  const [aspect, setAspect] = useState(1);

  const texture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(refImage.dataUrl, (loaded) => {
      const image = loaded.image as { width?: number; height?: number } | undefined;
      const width = image?.width ?? 1;
      const height = image?.height ?? 1;
      setAspect(width > 0 && height > 0 ? width / height : 1);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [refImage.dataUrl]);

  useEffect(() => () => texture.dispose(), [texture]);

  const { position, rotation } = transformForPlane(refImage);
  const height = Math.max(0.001, finiteOr(refImage.scale, 1));
  const width = height * aspect;
  const opacity = Math.min(1, Math.max(0, finiteOr(refImage.opacity, 0.5)));

  return (
    <mesh position={position} rotation={rotation} renderOrder={-10}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

export default function CanvasReferences() {
  const canvasReferences = useCADStore((s) => s.canvasReferences);
  const features = useCADStore((s) => s.features);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);

  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    features.forEach((feature, index) => {
      if (!feature.params?.isCanvasRef) return;
      if (!feature.visible || feature.suppressed) return;
      if (rollbackIndex >= 0 && index > rollbackIndex) return;
      ids.add(feature.id);
    });
    return ids;
  }, [features, rollbackIndex]);

  return (
    <>
      {canvasReferences
        .filter((refImage) => visibleIds.has(refImage.id))
        .map((refImage) => (
          <CanvasReferenceImage key={refImage.id} refImage={refImage} />
        ))}
    </>
  );
}
