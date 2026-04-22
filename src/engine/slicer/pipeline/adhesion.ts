import * as THREE from 'three';

import type { PrintProfile, SliceMove } from '../../../types/slicer';
import type { Contour } from '../types';

interface AdhesionDeps {
  simplifyClosedContour: (points: THREE.Vector2[], tolerance: number) => THREE.Vector2[];
  offsetContour: (contour: THREE.Vector2[], offset: number) => THREE.Vector2[];
  generateScanLines: (
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    angle: number,
    phaseOffset?: number,
    holes?: THREE.Vector2[][],
  ) => { from: THREE.Vector2; to: THREE.Vector2 }[];
  sortInfillLines: (lines: { from: THREE.Vector2; to: THREE.Vector2 }[]) => { from: THREE.Vector2; to: THREE.Vector2 }[];
}

export function generateAdhesion(
  contours: Contour[],
  pp: PrintProfile,
  deps: AdhesionDeps,
): SliceMove[] {
  const moves: SliceMove[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const pt of contour.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }
  if (!isFinite(minX)) return moves;

  const speed = pp.firstLayerSpeed;
  const lineWidth = pp.skirtBrimLineWidth ?? pp.wallLineWidth;

  switch (pp.adhesionType) {
    case 'skirt': {
      const minLen = pp.skirtBrimMinLength ?? 0;
      const outerContours = contours.filter((contour) => contour.isOuter);
      let totalSkirtLen = 0;
      let skirtLine = 0;
      while (skirtLine < pp.skirtLines || (minLen > 0 && totalSkirtLen < minLen)) {
        const dist = pp.skirtDistance + skirtLine * lineWidth;
        const skirtOffset = dist + lineWidth * 0.5;
        let emittedLoop = false;
        for (const contour of outerContours) {
          const skirtContour = deps.simplifyClosedContour(
            deps.offsetContour(contour.points, -skirtOffset),
            Math.max(0.01, lineWidth * 0.05),
          );
          if (skirtContour.length < 3) continue;
          emittedLoop = true;
          for (let i = 0; i < skirtContour.length; i++) {
            const from = skirtContour[i];
            const to = skirtContour[(i + 1) % skirtContour.length];
            totalSkirtLen += from.distanceTo(to);
            moves.push({ type: 'skirt', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed, extrusion: 0, lineWidth });
          }
        }
        if (!emittedLoop) break;
        skirtLine++;
        if (skirtLine > 100) break;
      }
      break;
    }

    case 'brim': {
      const brimGapMm = pp.brimGap ?? 0;
      const brimAvoidMm = pp.brimAvoidMargin ?? 0;
      const smartBrimArea = (pp.smartBrim ?? false) ? Math.pow(pp.brimWidth * 6, 2) : Infinity;
      const brimLoops = Math.ceil(pp.brimWidth / lineWidth);
      for (let line = 0; line < brimLoops; line++) {
        const dist = brimGapMm + line * lineWidth;
        for (const contour of contours) {
          if (!contour.isOuter) continue;
          if (Math.abs(contour.area) > smartBrimArea) continue;
          const brimContour = deps.offsetContour(contour.points, -(dist + lineWidth));
          if (brimContour.length < 3) continue;
          if (brimAvoidMm > 0) {
            const innerContours = contours.filter((c) => !c.isOuter);
            const tooClose = innerContours.some((ic) =>
              brimContour.some((bp) =>
                ic.points.some((ip) => Math.hypot(bp.x - ip.x, bp.y - ip.y) < brimAvoidMm)
              )
            );
            if (tooClose) continue;
          }
          for (let i = 0; i < brimContour.length; i++) {
            const from = brimContour[i];
            const to = brimContour[(i + 1) % brimContour.length];
            moves.push({ type: 'brim', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed, extrusion: 0, lineWidth });
          }
        }
      }
      break;
    }

    case 'raft': {
      const raftMargin = pp.raftExtraMargin ?? 3;
      const smooth = pp.raftSmoothing ?? 0;
      const raftContour: THREE.Vector2[] = smooth > 0
        ? (() => {
            const rx0 = minX - raftMargin; const ry0 = minY - raftMargin;
            const rx1 = maxX + raftMargin; const ry1 = maxY + raftMargin;
            const r = Math.min(smooth, (rx1 - rx0) / 2, (ry1 - ry0) / 2);
            return [
              new THREE.Vector2(rx0 + r, ry0),
              new THREE.Vector2(rx1 - r, ry0),
              new THREE.Vector2(rx1, ry0 + r),
              new THREE.Vector2(rx1, ry1 - r),
              new THREE.Vector2(rx1 - r, ry1),
              new THREE.Vector2(rx0 + r, ry1),
              new THREE.Vector2(rx0, ry1 - r),
              new THREE.Vector2(rx0, ry0 + r),
            ];
          })()
        : [
            new THREE.Vector2(minX - raftMargin, minY - raftMargin),
            new THREE.Vector2(maxX + raftMargin, minY - raftMargin),
            new THREE.Vector2(maxX + raftMargin, maxY + raftMargin),
            new THREE.Vector2(minX - raftMargin, maxY + raftMargin),
          ];

      const baseLH = pp.raftBaseThickness;
      const baseLW = pp.raftBaseLineWidth ?? lineWidth * 1.5;
      const baseSpeed = pp.raftBaseSpeed ?? speed * 0.8;
      const baseSpacing = (pp.raftBaseLineSpacing ?? 0) > 0
        ? pp.raftBaseLineSpacing!
        : baseLW / ((100 - (pp.raftBaseInfillOverlap ?? 0)) / 100 || 1);
      const baseFlowMul = (pp.raftFlow ?? 100) / 100;
      const baseLines = deps.generateScanLines(raftContour, 100, baseSpacing > 0 ? baseLW : baseLW, Math.PI / 2);
      for (const line of baseLines) {
        moves.push({ type: 'raft', from: { x: line.from.x, y: line.from.y }, to: { x: line.to.x, y: line.to.y }, speed: baseSpeed, extrusion: 0, lineWidth: baseLW * baseFlowMul, layerHeight: baseLH });
      }

      const midCount = pp.raftMiddleLayers ?? 0;
      const midLH = pp.raftMiddleThickness ?? pp.raftBaseThickness;
      const midLW = pp.raftMiddleLineWidth ?? lineWidth;
      const midSpacing = (pp.raftMiddleLineSpacing ?? 0) > 0 ? pp.raftMiddleLineSpacing! : midLW;
      const midSpeed = pp.raftBaseSpeed ? pp.raftBaseSpeed * 1.0625 : speed * 0.85;
      for (let mli = 0; mli < midCount; mli++) {
        const angle = mli % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
        const midLines = deps.generateScanLines(raftContour, 100, midSpacing > midLW ? midLW : midLW, angle);
        for (const line of midLines) {
          moves.push({ type: 'raft', from: { x: line.from.x, y: line.from.y }, to: { x: line.to.x, y: line.to.y }, speed: midSpeed, extrusion: 0, lineWidth: midLW * baseFlowMul, layerHeight: midLH });
        }
      }

      const topCount = Math.max(1, pp.raftTopLayers ?? 2);
      const topLH = pp.raftTopThickness ?? pp.layerHeight;
      const topLW = pp.raftTopLineWidth ?? lineWidth;
      const topSpacing = (pp.raftTopLineSpacing ?? 0) > 0 ? pp.raftTopLineSpacing! : topLW;
      const topSpeed = speed * 0.9;
      const monotonicTop = pp.monotonicRaftTopSurface ?? false;
      for (let tli = 0; tli < topCount; tli++) {
        const angle = Math.PI / 2 + tli * Math.PI / 3;
        const rawTopLines = deps.generateScanLines(raftContour, 100, topSpacing, angle);
        const topLines = monotonicTop ? rawTopLines : deps.sortInfillLines(rawTopLines);
        for (const line of topLines) {
          moves.push({ type: 'raft', from: { x: line.from.x, y: line.from.y }, to: { x: line.to.x, y: line.to.y }, speed: topSpeed, extrusion: 0, lineWidth: topLW * baseFlowMul, layerHeight: topLH });
        }
      }

      const raftWalls = pp.raftWallCount ?? 0;
      for (let rw = 0; rw < raftWalls; rw++) {
        const inset = rw * lineWidth;
        const wallContour: THREE.Vector2[] = [
          new THREE.Vector2(minX - raftMargin + inset, minY - raftMargin + inset),
          new THREE.Vector2(maxX + raftMargin - inset, minY - raftMargin + inset),
          new THREE.Vector2(maxX + raftMargin - inset, maxY + raftMargin - inset),
          new THREE.Vector2(minX - raftMargin + inset, maxY + raftMargin - inset),
        ];
        for (let wi = 0; wi < wallContour.length; wi++) {
          const from = wallContour[wi];
          const to = wallContour[(wi + 1) % wallContour.length];
          moves.push({ type: 'raft', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, speed: speed * 0.85, extrusion: 0, lineWidth });
        }
      }
      break;
    }

    case 'none':
    default:
      break;
  }

  return moves;
}
