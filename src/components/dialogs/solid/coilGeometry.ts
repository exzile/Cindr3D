import * as THREE from 'three';

export type CoilSection = 'circle' | 'square' | 'triangle';
export type CoilDirection = 'cw' | 'ccw';

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  private readonly radius: number;
  private readonly height: number;
  private readonly revolutions: number;
  private readonly ccw: boolean;

  constructor(radius: number, height: number, revolutions: number, ccw: boolean) {
    super();
    this.radius = radius;
    this.height = height;
    this.revolutions = revolutions;
    this.ccw = ccw;
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = t * this.revolutions * 2 * Math.PI * (this.ccw ? -1 : 1);
    return target.set(
      this.radius * Math.cos(angle),
      t * this.height,
      this.radius * Math.sin(angle),
    );
  }
}

export function buildCoilGeometry(
  coilDiameter: number,
  _pitch: number,
  height: number,
  revolutions: number,
  sectionDiameter: number,
  section: CoilSection,
  direction: CoilDirection,
): THREE.BufferGeometry | null {
  const radius = Math.max(0.01, coilDiameter / 2);
  const sectionR = Math.max(0.001, sectionDiameter / 2);
  if (height < 0.001 || revolutions < 0.01) return null;

  const segments = Math.max(32, Math.round(revolutions * 48));
  const curve = new HelixCurve(radius, height, revolutions, direction === 'ccw');

  if (section === 'circle') {
    return new THREE.TubeGeometry(curve, segments, sectionR, 10, false);
  }

  const pts = curve.getPoints(segments);
  const path = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.5);
  const shape = new THREE.Shape();

  if (section === 'square') {
    const s = sectionR;
    shape.moveTo(-s, -s);
    shape.lineTo(s, -s);
    shape.lineTo(s, s);
    shape.lineTo(-s, s);
    shape.closePath();
  } else {
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) shape.moveTo(sectionR * Math.cos(angle), sectionR * Math.sin(angle));
      else shape.lineTo(sectionR * Math.cos(angle), sectionR * Math.sin(angle));
    }
    shape.closePath();
  }

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    steps: segments,
    extrudePath: path,
    bevelEnabled: false,
  };

  try {
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  } catch {
    return new THREE.TubeGeometry(curve, segments, sectionR, 10, false);
  }
}

export const COIL_MESH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x8899aa,
  roughness: 0.5,
  metalness: 0.3,
});
