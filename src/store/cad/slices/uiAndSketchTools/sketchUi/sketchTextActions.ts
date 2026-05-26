import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createSketchTextActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sketchTextContent: "Text",
    sketchTextHeight: 5,
    sketchTextFont: "default",
    sketchTextBold: false,
    sketchTextItalic: false,
    setSketchTextContent: (value) => set({ sketchTextContent: value }),
    setSketchTextHeight: (value) => set({ sketchTextHeight: value }),
    setSketchTextFont: (value) => set({ sketchTextFont: value }),
    setSketchTextBold: (value) => set({ sketchTextBold: value }),
    setSketchTextItalic: (value) => set({ sketchTextItalic: value }),
    startSketchTextTool: () => {
      const { activeSketch } = get();
      if (!activeSketch) {
        set({ statusMessage: "Open a sketch first before using Sketch Text" });
        return;
      }
      set({ activeTool: "sketch-text", statusMessage: "Sketch Text - click on the sketch to place text" });
    },
    commitSketchTextEntities: (segments) => {
      const { activeSketch, sketches } = get();
      if (!activeSketch) return;
      const newEntities = segments.map((segment) => ({
        id: crypto.randomUUID(),
        type: "line" as const,
        points: [
          { id: crypto.randomUUID(), x: segment.x1, y: segment.y1, z: segment.z1 },
          { id: crypto.randomUUID(), x: segment.x2, y: segment.y2, z: segment.z2 },
        ],
      }));
      const nextSketch = {
        ...activeSketch,
        entities: [...activeSketch.entities, ...newEntities],
      };
      set({
        activeSketch: nextSketch,
        sketches: sketches.map((sketch) => (sketch.id === nextSketch.id ? nextSketch : sketch)),
        activeTool: "select",
        statusMessage: "Text placed",
      });
    },
    cancelSketchTextTool: () => set({ activeTool: "select", statusMessage: "Sketch Text cancelled" }),
  };
}
