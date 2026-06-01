import * as THREE from 'three';

export type CoilSection = 'circle' | 'square' | 'triangle' | 'triangle-external' | 'triangle-internal';
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

// Archimedean spiral: r(θ) = r_start + (pitch/(2π)) * θ, flat on XZ plane
class SpiralCurve extends THREE.Curve<THREE.Vector3> {
  private readonly rStart: number;
  private readonly rEnd: number;
  private readonly revolutions: number;
  private readonly ccw: boolean;

  constructor(rStart: number, rEnd: number, revolutions: number, ccw: boolean) {
    super();
    this.rStart = rStart;
    this.rEnd = rEnd;
    this.revolutions = revolutions;
    this.ccw = ccw;
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const angle = t * this.revolutions * 2 * Math.PI * (this.ccw ? -1 : 1);
    const r = this.rStart + (this.rEnd - this.rStart) * t;
    return target.set(r * Math.cos(angle), 0, r * Math.sin(angle));
  }
}

function buildTriangleShape(sectionR: number, apexAngleDeg: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + THREE.MathUtils.degToRad(apexAngleDeg);
    if (i === 0) shape.moveTo(sectionR * Math.cos(angle), sectionR * Math.sin(angle));
    else shape.lineTo(sectionR * Math.cos(angle), sectionR * Math.sin(angle));
  }
  shape.closePath();
  return shape;
}

export function buildCoilGeometry(
  coilDiameter: number,
  pitch: number,
  height: number,
  revolutions: number,
  sectionDiameter: number,
  section: CoilSection,
  direction: CoilDirection,
  isSpiral = false,
): THREE.BufferGeometry | null {
  const radius = Math.max(0.01, coilDiameter / 2);
  const sectionR = Math.max(0.001, sectionDiameter / 2);

  let curve: THREE.Curve<THREE.Vector3>;
  const segments = Math.max(32, Math.round(revolutions * 48));

  if (isSpiral) {
    if (revolutions < 0.01) return null;
    // For a spiral: rEnd = rStart + pitch * revolutions (radial growth)
    const pitchRadius = Math.max(0.1, pitch);
    const rEnd = Math.max(radius + pitchRadius * revolutions, radius + sectionR);
    curve = new SpiralCurve(radius, rEnd, revolutions, direction === 'ccw');
  } else {
    if (height < 0.001 || revolutions < 0.01) return null;
    curve = new HelixCurve(radius, height, revolutions, direction === 'ccw');
  }

  if (section === 'circle') {
    return new THREE.TubeGeometry(curve as THREE.Curve<THREE.Vector3>, segments, sectionR, 10, false);
  }

  const pts = curve.getPoints(segments);
  const path = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.5);
  let shape: THREE.Shape;

  if (section === 'square') {
    const s = sectionR;
    shape = new THREE.Shape();
    shape.moveTo(-s, -s);
    shape.lineTo(s, -s);
    shape.lineTo(s, s);
    shape.lineTo(-s, s);
    shape.closePath();
  } else if (section === 'triangle-external') {
    // Apex at +Y (pointing outward when tube travels around coil)
    shape = buildTriangleShape(sectionR, -90);
  } else if (section === 'triangle-internal') {
    // Apex at -Y (pointing inward — groove/valley form)
    shape = buildTriangleShape(sectionR, 90);
  } else {
    // 'triangle' — default: apex at -90° (same as external, legacy compat)
    shape = buildTriangleShape(sectionR, -90);
  }

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    steps: segments,
    extrudePath: path,
    bevelEnabled: false,
  };

  try {
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  } catch {
    return new THREE.TubeGeometry(curve as THREE.Curve<THREE.Vector3>, segments, sectionR, 10, false);
  }
}

export const COIL_MESH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x8899aa,
  roughness: 0.5,
  metalness: 0.3,
});
