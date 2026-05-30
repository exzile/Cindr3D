import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';

export function createGridSnapActions({ set }: CADSliceContext): Partial<CADState> {
  return {
    gridSize: 10,
    setGridSize: (size) => set({ gridSize: size }),
    sketchGridSize: null,
    setSketchGridSize: (size) => set({ sketchGridSize: size }),
    snapEnabled: true,
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    objectSnapEnabled: true,
    setObjectSnapEnabled: (v) => set({ objectSnapEnabled: v }),
    snapToEndpoint: true,
    setSnapToEndpoint: (v) => set({ snapToEndpoint: v }),
    snapToMidpoint: true,
    setSnapToMidpoint: (v) => set({ snapToMidpoint: v }),
    snapToCenter: true,
    setSnapToCenter: (v) => set({ snapToCenter: v }),
    snapToIntersection: true,
    setSnapToIntersection: (v) => set({ snapToIntersection: v }),
    snapToPerpendicular: true,
    setSnapToPerpendicular: (v) => set({ snapToPerpendicular: v }),
    snapToTangent: true,
    setSnapToTangent: (v) => set({ snapToTangent: v }),
    gridVisible: true,
    setGridVisible: (visible) => set({ gridVisible: visible }),
    sketchPolygonSides: 6,
    setSketchPolygonSides: (sides) => set({ sketchPolygonSides: Math.max(3, Math.min(128, Math.round(sides))) }),
    sketchFilletRadius: 2,
    setSketchFilletRadius: (r) => set({ sketchFilletRadius: Math.max(0.01, r) }),
    sketchSlotWidth: 4,
    setSketchSlotWidth: (w) => set({ sketchSlotWidth: Math.max(0.01, w) }),
  };
}
