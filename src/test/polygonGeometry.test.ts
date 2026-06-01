import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { polygonVertexPositions, polygonLoop } from '../components/viewport/interaction/sketchInteraction/polygonGeometry';

const t1 = new THREE.Vector3(1, 0, 0);
const t2 = new THREE.Vector3(0, 1, 0);
const center = new THREE.Vector3(0, 0, 0);

describe('polygonGeometry', () => {
  describe('inscribed', () => {
    it('places a vertex exactly under the cursor (cursor angle drives rotation)', () => {
      // cursor at 30° from +t1, radius 10
      const baseAngle = Math.PI / 6;
      const verts = polygonVertexPositions(center, 10, 5, baseAngle, 'inscribed', t1, t2);
      expect(verts).toHaveLength(5);
      // first vertex must sit at the cursor angle and radius
      expect(verts[0].x).toBeCloseTo(Math.cos(baseAngle) * 10, 6);
      expect(verts[0].y).toBeCloseTo(Math.sin(baseAngle) * 10, 6);
    });

    it('all vertices lie on the circumscribing circle (radius = cursor distance)', () => {
      const verts = polygonVertexPositions(center, 7, 6, 0, 'inscribed', t1, t2);
      for (const v of verts) {
        expect(v.distanceTo(center)).toBeCloseTo(7, 6);
      }
    });

    it('respects the requested side count', () => {
      expect(polygonVertexPositions(center, 5, 3, 0, 'inscribed', t1, t2)).toHaveLength(3);
      expect(polygonVertexPositions(center, 5, 8, 0, 'inscribed', t1, t2)).toHaveLength(8);
    });
  });

  describe('circumscribed', () => {
    it('places an edge midpoint under the cursor at the apothem distance', () => {
      const baseAngle = Math.PI / 4;
      const apothem = 10;
      const sides = 6;
      const verts = polygonVertexPositions(center, apothem, sides, baseAngle, 'circumscribed', t1, t2);
      // midpoint of the first edge (between vert 0 and vert 1)
      const mid = verts[0].clone().add(verts[1]).multiplyScalar(0.5);
      expect(mid.distanceTo(center)).toBeCloseTo(apothem, 6);
      // and it points in the cursor direction
      const midAngle = Math.atan2(mid.dot(t2), mid.dot(t1));
      expect(midAngle).toBeCloseTo(baseAngle, 6);
    });

    it('uses circumradius = apothem / cos(pi/n) so vertices are outside the inscribed circle', () => {
      const apothem = 10;
      const sides = 4; // square
      const verts = polygonVertexPositions(center, apothem, sides, 0, 'circumscribed', t1, t2);
      const expectedR = apothem / Math.cos(Math.PI / sides);
      for (const v of verts) {
        expect(v.distanceTo(center)).toBeCloseTo(expectedR, 6);
      }
    });
  });

  describe('polygonLoop', () => {
    it('closes the loop by repeating the first vertex', () => {
      const verts = polygonVertexPositions(center, 5, 4, 0, 'inscribed', t1, t2);
      const loop = polygonLoop(verts);
      expect(loop).toHaveLength(5);
      expect(loop[4].x).toBeCloseTo(loop[0].x, 6);
      expect(loop[4].y).toBeCloseTo(loop[0].y, 6);
    });
  });
});
