import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";
import type { SketchTextMeta } from "../../../../../types/cad";
import { GeometryEngine } from "../../../../../engine/GeometryEngine";
import { generateText3DContours, generateTextAlongPathContours } from "../../../../../utils/sketchTextGenerate";

export function createSketchTextActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    sketchTextContent: "Text",
    sketchTextHeight: 5,
    sketchTextFont: "default",
    sketchTextBold: false,
    sketchTextItalic: false,
    sketchTextType: "standard",
    sketchTextCharSpacing: 0,
    sketchTextFlipH: false,
    sketchTextFlipV: false,
    sketchTextHAlign: "left",
    sketchTextVAlign: "bottom",
    editingTextGroupId: null,
    setSketchTextContent: (value) => set({ sketchTextContent: value }),
    setSketchTextHeight: (value) => set({ sketchTextHeight: value }),
    setSketchTextFont: (value) => set({ sketchTextFont: value }),
    setSketchTextBold: (value) => set({ sketchTextBold: value }),
    setSketchTextItalic: (value) => set({ sketchTextItalic: value }),
    setSketchTextType: (value) => set({ sketchTextType: value }),
    setSketchTextCharSpacing: (value) => set({ sketchTextCharSpacing: value }),
    setSketchTextFlipH: (value) => set({ sketchTextFlipH: value }),
    setSketchTextFlipV: (value) => set({ sketchTextFlipV: value }),
    setSketchTextHAlign: (value) => set({ sketchTextHAlign: value }),
    setSketchTextVAlign: (value) => set({ sketchTextVAlign: value }),
    startSketchTextTool: () => {
      const { activeSketch } = get();
      if (!activeSketch) {
        set({ statusMessage: "Open a sketch first before using Sketch Text" });
        return;
      }
      set({ activeTool: "sketch-text", editingTextGroupId: null, statusMessage: "Sketch Text - click on the sketch to place text" });
    },
    startSketchTextEdit: (groupId: string) => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const metaEntity = activeSketch.entities.find(
        (e) => e.textGroupId === groupId && e.textMeta,
      );
      const meta = metaEntity?.textMeta;
      if (!meta) return;
      set({
        sketchTextContent: meta.content,
        sketchTextHeight: meta.height,
        sketchTextFont: meta.font,
        sketchTextBold: meta.bold,
        sketchTextItalic: meta.italic,
        sketchTextCharSpacing: meta.charSpacing,
        sketchTextFlipH: meta.flipH,
        sketchTextFlipV: meta.flipV,
        sketchTextHAlign: meta.hAlign,
        sketchTextVAlign: meta.vAlign,
        sketchTextType: meta.type ?? "standard",
        editingTextGroupId: groupId,
        activeTool: "sketch-text",
        statusMessage: "Editing text - adjust settings, then click OK",
      });
    },
    commitSketchTextEdit: () => {
      const { activeSketch, editingTextGroupId } = get();
      if (!activeSketch || !editingTextGroupId) return;
      const metaEntity = activeSketch.entities.find(
        (e) => e.textGroupId === editingTextGroupId && e.textMeta,
      );
      const anchor = metaEntity?.textMeta?.anchor;
      if (!anchor) return;
      const prevMeta = metaEntity?.textMeta;
      const meta: SketchTextMeta = {
        content: get().sketchTextContent,
        height: get().sketchTextHeight,
        font: get().sketchTextFont,
        bold: get().sketchTextBold,
        italic: get().sketchTextItalic,
        charSpacing: get().sketchTextCharSpacing,
        flipH: get().sketchTextFlipH,
        flipV: get().sketchTextFlipV,
        hAlign: get().sketchTextHAlign,
        vAlign: get().sketchTextVAlign,
        anchor: { ...anchor },
        type: prevMeta?.type ?? "standard",
        pathEntityId: prevMeta?.pathEntityId,
      };
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      // Re-edit an along-path text along its original curve when still present.
      const pathEntity = meta.type === "along-path" && meta.pathEntityId
        ? activeSketch.entities.find((e) => e.id === meta.pathEntityId)
        : undefined;
      const work = pathEntity
        ? generateTextAlongPathContours(activeSketch.planeOrigin, t1, t2, pathEntity, meta)
        : generateText3DContours(t1, t2, meta);
      void work.then((contours) => {
        get().commitSketchTextEntities(contours, meta);
      });
    },
    commitTextAlongPath: (pathEntityId: string) => {
      const { activeSketch } = get();
      if (!activeSketch) return;
      const pathEntity = activeSketch.entities.find((e) => e.id === pathEntityId);
      if (!pathEntity || pathEntity.textGroupId) {
        set({ statusMessage: "Text on path: click a sketch curve (line, arc, circle, or spline)" });
        return;
      }
      const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
      const origin = activeSketch.planeOrigin;
      const start = pathEntity.points[0] ?? { x: origin.x, y: origin.y, z: origin.z };
      const meta: SketchTextMeta = {
        content: get().sketchTextContent,
        height: get().sketchTextHeight,
        font: get().sketchTextFont,
        bold: get().sketchTextBold,
        italic: get().sketchTextItalic,
        charSpacing: get().sketchTextCharSpacing,
        flipH: get().sketchTextFlipH,
        flipV: get().sketchTextFlipV,
        hAlign: get().sketchTextHAlign,
        vAlign: get().sketchTextVAlign,
        anchor: { x: start.x, y: start.y, z: start.z },
        type: "along-path",
        pathEntityId,
      };
      void generateTextAlongPathContours(origin, t1, t2, pathEntity, meta).then((contours) => {
        get().commitSketchTextEntities(contours, meta);
      });
    },
    commitSketchTextEntities: (contours, meta) => {
      const { activeSketch, sketches, editingTextGroupId } = get();
      if (!activeSketch) return;
      const groupId = editingTextGroupId ?? crypto.randomUUID();
      // Each glyph contour → one closed spline entity. Closed loops let the
      // profile detector treat text as fillable/extrudable regions, and counters
      // (holes in e/a/o/B/8) nest automatically via parent/child containment.
      const newEntities = contours
        .filter((contour) => contour.length >= 3)
        .map((contour, index) => ({
          id: crypto.randomUUID(),
          type: "spline" as const,
          closed: true,
          points: contour.map((p) => ({ id: crypto.randomUUID(), x: p.x, y: p.y, z: p.z })),
          textGroupId: groupId,
          // Store the full meta once, on the group's first contour.
          ...(index === 0 && meta ? { textMeta: meta } : {}),
        }));
      // When editing, drop the old group's segments before adding the new ones.
      const baseEntities = editingTextGroupId
        ? activeSketch.entities.filter((e) => e.textGroupId !== editingTextGroupId)
        : activeSketch.entities;
      const nextSketch = {
        ...activeSketch,
        entities: [...baseEntities, ...newEntities],
      };
      set({
        activeSketch: nextSketch,
        sketches: sketches.map((sketch) => (sketch.id === nextSketch.id ? nextSketch : sketch)),
        activeTool: "select",
        editingTextGroupId: null,
        statusMessage: editingTextGroupId ? "Text updated" : "Text placed",
      });
    },
    cancelSketchTextTool: () => set({ activeTool: "select", editingTextGroupId: null, statusMessage: "Sketch Text cancelled" }),
  };
}
