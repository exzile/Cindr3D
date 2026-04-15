import * as React from 'react';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { LayerGeometryData } from './types';

interface LayerMeshProps {
  data: LayerGeometryData;
  opacity: number;
  showTravel: boolean;
  showRetractions: boolean;
}

export const LayerMesh = React.memo(function LayerMesh({
  data,
  opacity,
  showTravel,
  showRetractions,
}: LayerMeshProps) {
  const extGeo = useMemo(() => {
    if (data.extrusionPositions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.extrusionPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.extrusionColors, 3));
    return geo;
  }, [data.extrusionPositions, data.extrusionColors]);

  const travGeo = useMemo(() => {
    if (data.travelPositions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.travelPositions, 3));
    return geo;
  }, [data.travelPositions]);

  const retGeo = useMemo(() => {
    if (data.retractionPoints.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.retractionPoints, 3));
    return geo;
  }, [data.retractionPoints]);

  return (
    <group>
      {extGeo && (
        <lineSegments geometry={extGeo}>
          <lineBasicMaterial
            vertexColors
            transparent={opacity < 1}
            opacity={opacity}
            depthWrite={opacity >= 1}
            linewidth={1}
          />
        </lineSegments>
      )}

      {showTravel && travGeo && (
        <lineSegments geometry={travGeo}>
          <lineDashedMaterial
            color="#444444"
            dashSize={1}
            gapSize={0.5}
            transparent
            opacity={opacity * 0.5}
            depthWrite={false}
            linewidth={1}
          />
        </lineSegments>
      )}

      {showRetractions && retGeo && (
        <points geometry={retGeo}>
          <pointsMaterial
            color="#f44336"
            size={0.6}
            sizeAttenuation
            transparent
            opacity={opacity}
            depthWrite={false}
          />
        </points>
      )}
    </group>
  );
});
