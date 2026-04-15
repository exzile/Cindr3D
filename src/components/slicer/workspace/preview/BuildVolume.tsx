import * as React from 'react';
import * as THREE from 'three';
import { Grid, Line } from '@react-three/drei';

interface BuildPlateProps {
  volumeX: number;
  volumeY: number;
  volumeZ: number;
  originCenter: boolean;
}

export function BuildVolume({ volumeX, volumeY, volumeZ, originCenter }: BuildPlateProps) {
  const offsetX = originCenter ? 0 : volumeX / 2;
  const offsetY = originCenter ? 0 : volumeY / 2;

  const boxGeo = React.useMemo(
    () => new THREE.BoxGeometry(volumeX, volumeY, volumeZ),
    [volumeX, volumeY, volumeZ],
  );

  return (
    <group position={[offsetX, offsetY, 0]}>
      <Grid
        args={[volumeX, volumeY]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#555555"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#888888"
        fadeDistance={1000}
        fadeStrength={0}
        infiniteGrid={false}
      />

      <group position={[0, 0, volumeZ / 2]}>
        <lineSegments>
          <edgesGeometry args={[boxGeo]} />
          <lineBasicMaterial color="#666666" transparent opacity={0.25} />
        </lineSegments>
      </group>
    </group>
  );
}

export function LayerHeightIndicator({
  z,
  sizeX,
  sizeY,
  originCenter,
}: {
  z: number;
  sizeX: number;
  sizeY: number;
  originCenter: boolean;
}) {
  const offsetX = originCenter ? 0 : sizeX / 2;
  const offsetY = originCenter ? 0 : sizeY / 2;

  const points = React.useMemo(
    () => [
      new THREE.Vector3(-sizeX / 2 + offsetX, -sizeY / 2 + offsetY, z),
      new THREE.Vector3(sizeX / 2 + offsetX, -sizeY / 2 + offsetY, z),
      new THREE.Vector3(sizeX / 2 + offsetX, sizeY / 2 + offsetY, z),
      new THREE.Vector3(-sizeX / 2 + offsetX, sizeY / 2 + offsetY, z),
      new THREE.Vector3(-sizeX / 2 + offsetX, -sizeY / 2 + offsetY, z),
    ],
    [z, sizeX, sizeY, offsetX, offsetY],
  );

  return (
    <Line
      points={points}
      color="#ff5722"
      lineWidth={1}
      transparent
      opacity={0.5}
      dashed={false}
    />
  );
}
