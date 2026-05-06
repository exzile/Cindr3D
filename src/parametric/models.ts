import * as THREE from 'three';
import type { ParametricModelDefinition, ParametricParameterValue } from './types';
import { finishMesh, groupToMesh, material, mm } from './utils';

const box = (w: number, h: number, d: number, color?: number) => finishMesh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color)));
const cyl = (r: number, h: number, segments = 32, color?: number) => finishMesh(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material(color)));

export const PARAMETRIC_MODELS: ParametricModelDefinition[] = [
  {
    id: 'gridfinity-bin',
    name: 'Gridfinity Bin',
    category: 'Storage',
    description: 'Configurable Gridfinity-style storage bin.',
    parameters: [
      { key: 'unitsX', label: 'Units X', type: 'number', defaultValue: 2, min: 1, max: 8, step: 1 },
      { key: 'unitsY', label: 'Units Y', type: 'number', defaultValue: 1, min: 1, max: 8, step: 1 },
      { key: 'height', label: 'Height', type: 'number', defaultValue: 42, min: 14, max: 120, step: 1 },
      { key: 'wall', label: 'Wall', type: 'number', defaultValue: 1.2, min: 0.6, max: 4, step: 0.1 },
    ],
    build: (params) => {
      const w = mm(params.unitsX, 2) * 42;
      const d = mm(params.unitsY, 1) * 42;
      const h = mm(params.height, 42);
      const wall = mm(params.wall, 1.2);
      const group = new THREE.Group();
      const base = box(w, 4, d, 0x64748b);
      base.position.y = 2;
      group.add(base);
      const back = box(w, h, wall, 0x94a3b8);
      back.position.set(0, h / 2, -d / 2 + wall / 2);
      group.add(back);
      const front = box(w, h * 0.65, wall, 0x94a3b8);
      front.position.set(0, h * 0.325, d / 2 - wall / 2);
      group.add(front);
      const left = box(wall, h, d, 0x94a3b8);
      left.position.set(-w / 2 + wall / 2, h / 2, 0);
      group.add(left);
      const right = box(wall, h, d, 0x94a3b8);
      right.position.set(w / 2 - wall / 2, h / 2, 0);
      group.add(right);
      return groupToMesh(group, 'Gridfinity Bin');
    },
  },
  {
    id: 'threaded-insert-boss',
    name: 'Threaded Insert Boss',
    category: 'Hardware',
    description: 'Mounting boss sized for heat-set inserts.',
    parameters: [
      { key: 'insertDiameter', label: 'Insert Diameter', type: 'number', defaultValue: 5, min: 2, max: 12, step: 0.1 },
      { key: 'outerDiameter', label: 'Outer Diameter', type: 'number', defaultValue: 10, min: 4, max: 30, step: 0.1 },
      { key: 'height', label: 'Height', type: 'number', defaultValue: 8, min: 2, max: 40, step: 0.1 },
    ],
    build: (params) => cyl(mm(params.outerDiameter, 10) / 2, mm(params.height, 8), 48, 0x718096),
  },
  {
    id: 'angle-bracket',
    name: 'Angle Bracket',
    category: 'Brackets',
    description: 'Simple L bracket blank with adjustable legs.',
    parameters: [
      { key: 'width', label: 'Width', type: 'number', defaultValue: 28, min: 8, max: 100, step: 1 },
      { key: 'legA', label: 'Leg A', type: 'number', defaultValue: 40, min: 8, max: 160, step: 1 },
      { key: 'legB', label: 'Leg B', type: 'number', defaultValue: 40, min: 8, max: 160, step: 1 },
      { key: 'thickness', label: 'Thickness', type: 'number', defaultValue: 4, min: 1, max: 20, step: 0.5 },
    ],
    build: (params) => {
      const width = mm(params.width, 28);
      const a = mm(params.legA, 40);
      const b = mm(params.legB, 40);
      const t = mm(params.thickness, 4);
      const group = new THREE.Group();
      const vertical = box(width, a, t, 0x7c8aa0);
      vertical.position.set(0, a / 2, -b / 2 + t / 2);
      group.add(vertical);
      const foot = box(width, t, b, 0x7c8aa0);
      foot.position.set(0, t / 2, 0);
      group.add(foot);
      return groupToMesh(group, 'Angle Bracket');
    },
  },
  {
    id: 'project-box',
    name: 'Project Box',
    category: 'Enclosures',
    description: 'Parametric electronics enclosure blank.',
    parameters: [
      { key: 'width', label: 'Width', type: 'number', defaultValue: 80, min: 20, max: 240, step: 1 },
      { key: 'depth', label: 'Depth', type: 'number', defaultValue: 50, min: 20, max: 180, step: 1 },
      { key: 'height', label: 'Height', type: 'number', defaultValue: 28, min: 8, max: 120, step: 1 },
    ],
    build: (params) => box(mm(params.width, 80), mm(params.height, 28), mm(params.depth, 50), 0x6b7280),
  },
  {
    id: 'cable-clip',
    name: 'Cable Clip',
    category: 'Clips',
    description: 'Rounded cable clip channel.',
    parameters: [
      { key: 'diameter', label: 'Cable Diameter', type: 'number', defaultValue: 6, min: 2, max: 30, step: 0.5 },
      { key: 'width', label: 'Width', type: 'number', defaultValue: 12, min: 4, max: 60, step: 1 },
    ],
    build: (params) => cyl(mm(params.diameter, 6), mm(params.width, 12), 32, 0x5b8def),
  },
  {
    id: 'spur-gear',
    name: 'Spur Gear Blank',
    category: 'Motion',
    description: 'Gear/pulley blank with tooth-count metadata.',
    parameters: [
      { key: 'teeth', label: 'Teeth', type: 'number', defaultValue: 24, min: 8, max: 120, step: 1 },
      { key: 'pitchDiameter', label: 'Pitch Diameter', type: 'number', defaultValue: 36, min: 8, max: 180, step: 1 },
      { key: 'thickness', label: 'Thickness', type: 'number', defaultValue: 8, min: 2, max: 50, step: 1 },
    ],
    build: (params) => cyl(mm(params.pitchDiameter, 36) / 2, mm(params.thickness, 8), Math.max(16, mm(params.teeth, 24)), 0x8994a8),
  },
];

export function getDefaultParams(model: ParametricModelDefinition): Record<string, ParametricParameterValue> {
  return Object.fromEntries(model.parameters.map((parameter) => [parameter.key, parameter.defaultValue]));
}
