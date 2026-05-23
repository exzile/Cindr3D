import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import * as React from "react";
import * as THREE from "three";
import { LayoutGrid, XCircle, Layers } from "lucide-react";
import { useSlicerStore } from "../../../../store/slicerStore";
import { errorMessage } from "../../../../utils/errorHandling";
import { useCADStore } from "../../../../store/cadStore";
import { useComponentStore } from "../../../../store/componentStore";
import type { PlateObject } from "../../../../types/slicer";
import { validatePlate } from "../../../../store/slicer/plateValidation";
import { CalibrationMenu } from "../bottom/CalibrationMenu";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { GeometryToolsModal, type GeometryTool } from "../GeometryToolsModal";
import { computeMeshStats } from "../../../../engine/meshStats";
import { fetchModelUrlToFile } from "../../../../utils/printFromUrl";
import { AddCadMenu } from "./objectsPanel/AddCadMenu";
import { resolveCadBodyGeometry } from "./objectsPanel/addCadBodyToPlate";
import { ImportControls } from "./objectsPanel/ImportControls";
import { buildObjectContextMenuItems } from "./objectsPanel/objectContextMenu";
import { ObjectRow } from "./objectsPanel/ObjectRow";
import { PlateFileActions } from "./objectsPanel/PlateFileActions";
import { ValidationSummary } from "./objectsPanel/ValidationSummary";
import "./SlicerWorkspaceObjectsPanel.css";

export function SlicerWorkspaceObjectsPanel() {
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const additionalSelectedIds = useSlicerStore((s) => s.additionalSelectedIds);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const togglePlateObjectInSelection = useSlicerStore(
    (s) => s.togglePlateObjectInSelection,
  );
  const selectPlateObjectRange = useSlicerStore(
    (s) => s.selectPlateObjectRange,
  );
  const removeFromPlate = useSlicerStore((s) => s.removeFromPlate);
  const autoArrange = useSlicerStore((s) => s.autoArrange);
  const clearPlate = useSlicerStore((s) => s.clearPlate);
  const addToPlate = useSlicerStore((s) => s.addToPlate);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const importFileToPlate = useSlicerStore((s) => s.importFileToPlate);
  const duplicatePlateObject = useSlicerStore((s) => s.duplicatePlateObject);
  const exportPlateJson = useSlicerStore((s) => s.exportPlateJson);
  const exportPlateThreeMf = useSlicerStore((s) => s.exportPlateThreeMf);
  const importPlateJson = useSlicerStore((s) => s.importPlateJson);
  const layFlatPlateObject = useSlicerStore((s) => s.layFlatPlateObject);
  const autoOrientPlateObject = useSlicerStore((s) => s.autoOrientPlateObject);
  const dropToBedPlateObject = useSlicerStore((s) => s.dropToBedPlateObject);
  const centerPlateObject = useSlicerStore((s) => s.centerPlateObject);
  const reorderPlateObjects = useSlicerStore((s) => s.reorderPlateObjects);
  const resolveOverlapForObject = useSlicerStore(
    (s) => s.resolveOverlapForObject,
  );
  const getActivePrinterProfile = useSlicerStore(
    (s) => s.getActivePrinterProfile,
  );
  const getActiveMaterialProfile = useSlicerStore(
    (s) => s.getActiveMaterialProfile,
  );
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const features = useCADStore((s) => s.features);
  const cadBodies = useComponentStore((s) => s.bodies);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [colorPickerForId, setColorPickerForId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [activeTool, setActiveTool] = useState<{
    tool: GeometryTool;
    id: string;
  } | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plateLoadInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const openColorPicker = useCallback((id: string) => {
    setColorPickerForId(id);
    requestAnimationFrame(() => colorInputRef.current?.click());
  }, []);

  const buildContextMenuItems = useCallback(
    (id: string): ContextMenuItem[] => {
      const obj = plateObjects.find((o) => o.id === id);
      return buildObjectContextMenuItems({
        id,
        object: obj,
        duplicatePlateObject,
        updatePlateObject,
        layFlatPlateObject,
        autoOrientPlateObject,
        dropToBedPlateObject,
        centerPlateObject,
        resolveOverlapForObject,
        openColorPicker,
        removeFromPlate,
        setActiveTool,
      });
    },
    [
      plateObjects,
      duplicatePlateObject,
      updatePlateObject,
      layFlatPlateObject,
      autoOrientPlateObject,
      dropToBedPlateObject,
      centerPlateObject,
      resolveOverlapForObject,
      openColorPicker,
      removeFromPlate,
    ],
  );

  // Listen for "open context menu for this object" events fired from the
  // viewport mesh on right-click. Keeps the menu logic in one place
  // (here) rather than duplicating it inside the 3D scene.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ id: string; x: number; y: number }>)
        .detail;
      setContextMenu({ ...detail, items: buildContextMenuItems(detail.id) });
    };
    window.addEventListener("slicer:object-context-menu", handler);
    return () =>
      window.removeEventListener("slicer:object-context-menu", handler);
  }, [buildContextMenuItems]);

  const selectedIds = useMemo(
    () => (selectedId ? [selectedId, ...additionalSelectedIds] : []),
    [selectedId, additionalSelectedIds],
  );

  const printer = getActivePrinterProfile();
  const validation = useMemo(
    () =>
      validatePlate(
        plateObjects,
        printer?.buildVolume ?? { x: 220, y: 220, z: 250 },
        {
          originCenter: printer?.originCenter,
        },
      ),
    [plateObjects, printer?.buildVolume, printer?.originCenter],
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      if (isMountedRef.current) {
        setImporting(true);
        setImportError(null);
      }
      try {
        await importFileToPlate(file);
      } catch (err) {
        if (isMountedRef.current) {
          setImportError(errorMessage(err, "Unknown error"));
        }
      } finally {
        if (isMountedRef.current) {
          setImporting(false);
        }
      }
    },
    [importFileToPlate],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImportFile(file);
      if (e.target) e.target.value = "";
    },
    [handleImportFile],
  );

  const handleImportUrl = useCallback(async () => {
    const url = modelUrl.trim();
    if (!url) return;
    if (isMountedRef.current) {
      setImporting(true);
      setImportError(null);
    }
    try {
      const { file, sourceMetadata } = await fetchModelUrlToFile(url);
      const importedId = await importFileToPlate(file);
      if (importedId) {
        useSlicerStore.getState().updatePlateObject(importedId, {
          sourceMetadata,
        } as Partial<PlateObject>);
      }
      if (isMountedRef.current) setModelUrl("");
    } catch (err) {
      if (isMountedRef.current)
        setImportError(errorMessage(err, "Unknown error"));
    } finally {
      if (isMountedRef.current) setImporting(false);
    }
  }, [importFileToPlate, modelUrl]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleImportFile(file);
    },
    [handleImportFile],
  );

  const handleAddBody = useCallback(
    (bodyId: string, bodyName: string) => {
      const geo = resolveCadBodyGeometry(bodyId, features);
      addToPlate(bodyId, bodyName, geo);
      setShowAddMenu(false);
      setAddSearch("");
    },
    [addToPlate, features],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!isDragging) setIsDragging(true);
    },
    [isDragging],
  );

  // Bodies visible in the current design, sorted by name.
  const addableBodies = useMemo(() => {
    return Object.values(cadBodies)
      .filter((b) => b.visible !== false)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }, [cadBodies]);

  const filteredBodies = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return addableBodies;
    return addableBodies.filter((b) => b.name.toLowerCase().includes(q));
  }, [addableBodies, addSearch]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.shiftKey && selectedId) {
        selectPlateObjectRange(selectedId, id);
      } else if (e.ctrlKey || e.metaKey) {
        togglePlateObjectInSelection(id);
      } else {
        selectPlateObject(id);
      }
    },
    [
      selectedId,
      selectPlateObject,
      togglePlateObjectInSelection,
      selectPlateObjectRange,
    ],
  );

  const handleRowKeyboardSelect = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.shiftKey && selectedId) {
        selectPlateObjectRange(selectedId, id);
      } else if (e.ctrlKey || e.metaKey) {
        togglePlateObjectInSelection(id);
      } else {
        selectPlateObject(id);
      }
    },
    [
      selectedId,
      selectPlateObject,
      togglePlateObjectInSelection,
      selectPlateObjectRange,
    ],
  );

  const focusPlateRow = useCallback(
    (index: number) => {
      const bounded = Math.max(0, Math.min(plateObjects.length - 1, index));
      const id = plateObjects[bounded]?.id;
      if (!id) return;
      const row = document.querySelector<HTMLElement>(
        `[data-plate-row-id="${CSS.escape(id)}"]`,
      );
      row?.focus();
      selectPlateObject(id);
    },
    [plateObjects, selectPlateObject],
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, id: string) => {
      if (e.target !== e.currentTarget) return;
      const index = plateObjects.findIndex((obj) => obj.id === id);
      if (index < 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusPlateRow(index + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusPlateRow(index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusPlateRow(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusPlateRow(plateObjects.length - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleRowKeyboardSelect(e, id);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeFromPlate(id);
      } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        if (!selectedIds.includes(id)) selectPlateObject(id);
        const rect = e.currentTarget.getBoundingClientRect();
        setContextMenu({
          id,
          x: rect.left + 16,
          y: rect.top + 16,
          items: buildContextMenuItems(id),
        });
      }
    },
    [
      focusPlateRow,
      handleRowKeyboardSelect,
      plateObjects,
      removeFromPlate,
      selectedIds,
      selectPlateObject,
      buildContextMenuItems,
    ],
  );

  const handleColorChange = useCallback(
    (color: string) => {
      if (colorPickerForId)
        updatePlateObject(colorPickerForId, { color } as Partial<PlateObject>);
    },
    [colorPickerForId, updatePlateObject],
  );

  const handleSavePlate = useCallback(() => {
    const json = exportPlateJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plate.dzign-plate.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportPlateJson]);

  const handleSavePlateThreeMf = useCallback(async () => {
    const blob = await exportPlateThreeMf();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plate.3mf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportPlateThreeMf]);

  const handleLoadPlate = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        if (file.name.toLowerCase().endsWith(".3mf")) {
          await importFileToPlate(file);
        } else {
          const text = await file.text();
          importPlateJson(text);
        }
      } catch (err) {
        alert(`Plate load failed: ${errorMessage(err, "Unknown error")}`);
      } finally {
        if (e.target) e.target.value = "";
      }
    },
    [importFileToPlate, importPlateJson],
  );

  // Drag-to-reorder handlers. We use HTML5 drag events on the rows; Vite
  // / React-DnD would be heavier than needed here. The drag identifier is
  // the source object id; on drop we splice it before the target.
  const handleRowDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragRowId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plate-object-id", id);
  }, []);
  const handleRowDragOver = useCallback(
    (e: React.DragEvent) => {
      if (dragRowId) e.preventDefault();
    },
    [dragRowId],
  );
  const handleRowDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = dragRowId;
      setDragRowId(null);
      if (!sourceId || sourceId === targetId) return;
      const ids = plateObjects.map((o) => o.id);
      const fromIdx = ids.indexOf(sourceId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const reordered = [...ids];
      reordered.splice(fromIdx, 1);
      const insertAt = toIdx + (toIdx > fromIdx ? -1 : 0);
      reordered.splice(insertAt, 0, sourceId);
      reorderPlateObjects(reordered);
    },
    [dragRowId, plateObjects, reorderPlateObjects],
  );

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      if (!selectedIds.includes(id)) selectPlateObject(id);
      setContextMenu({
        id,
        x: e.clientX,
        y: e.clientY,
        items: buildContextMenuItems(id),
      });
    },
    [selectedIds, selectPlateObject, buildContextMenuItems],
  );

  // Per-row stats. Computed lazily via tooltip — heavy meshes don't pay
  // unless the user actually hovers. We memoize per-id to avoid re-computing
  // on every render.
  const statsCacheRef = useRef(new Map<string, string>());
  const buildRowTooltip = (obj: PlateObject): string => {
    const cached = statsCacheRef.current.get(obj.id);
    if (cached) return cached;
    if (!(obj.geometry instanceof THREE.BufferGeometry)) return obj.name;
    try {
      const stats = computeMeshStats(obj.geometry);
      const sx = obj.scale?.x ?? 1;
      const sy = obj.scale?.y ?? 1;
      const sz = obj.scale?.z ?? 1;
      const volScale = Math.abs(sx * sy * sz);
      const volMl = (stats.volumeMm3 * volScale) / 1000;
      const surfaceCm2 =
        (stats.surfaceAreaMm2 * Math.cbrt(volScale * volScale)) / 100;
      const text = [
        obj.name,
        `Triangles: ${stats.triangleCount.toLocaleString()}`,
        `Volume: ${volMl.toFixed(2)} cm³`,
        `Surface area: ${surfaceCm2.toFixed(1)} cm²`,
      ].join("\n");
      statsCacheRef.current.set(obj.id, text);
      return text;
    } catch {
      return obj.name;
    }
  };

  return (
    <div className="slicer-workspace-objects-panel">
      <div className="slicer-workspace-objects-panel__header">
        <Layers size={16} />
        Objects on Plate
      </div>

      <div className="slicer-workspace-objects-panel__list">
        <ImportControls
          fileInputRef={fileInputRef}
          importError={importError}
          importing={importing}
          isDragging={isDragging}
          modelUrl={modelUrl}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onFileInput={handleFileInput}
          onModelUrlChange={setModelUrl}
          onOpenFileDialog={() => fileInputRef.current?.click()}
          onSubmitUrl={() => void handleImportUrl()}
        />

        <ValidationSummary validation={validation} />

        {plateObjects.length === 0 && !importing && (
          <div className="slicer-workspace-objects-panel__empty">
            No objects on the build plate.
          </div>
        )}
        <div role="listbox" aria-label="Objects on build plate">
          {plateObjects.map((obj) => {
            const inSelection = selectedIds.includes(obj.id);
            const isAnchor = obj.id === selectedId;
            const issues = validation.issuesById.get(obj.id);
            return (
              <ObjectRow
                key={obj.id}
                object={obj}
                inSelection={inSelection}
                isAnchor={isAnchor}
                issues={issues}
                dragRowId={dragRowId}
                tooltip={buildRowTooltip(obj)}
                duplicatePlateObject={duplicatePlateObject}
                onColorPick={openColorPicker}
                onContextMenu={handleRowContextMenu}
                onDragEnd={() => setDragRowId(null)}
                onDragOver={handleRowDragOver}
                onDragStart={handleRowDragStart}
                onDrop={handleRowDrop}
                onKeyDown={handleRowKeyDown}
                onRowClick={handleRowClick}
                onRemove={removeFromPlate}
                onToggleHidden={(id, hidden) =>
                  updatePlateObject(id, { hidden } as Partial<PlateObject>)
                }
                onToggleLocked={(id, locked) =>
                  updatePlateObject(id, { locked } as Partial<PlateObject>)
                }
              />
            );
          })}
        </div>
      </div>

      <input
        ref={colorInputRef}
        type="color"
        className="slicer-workspace-objects-panel__color-input"
        value={
          (colorPickerForId &&
            plateObjects.find((o) => o.id === colorPickerForId)?.color) ||
          "#4fc3f7"
        }
        onChange={(e) => handleColorChange(e.target.value)}
      />

      <div className="slicer-workspace-objects-panel__actions">
        <AddCadMenu
          addSearch={addSearch}
          addableBodiesCount={addableBodies.length}
          filteredBodies={filteredBodies}
          onAddBody={handleAddBody}
          onSearchChange={setAddSearch}
          onToggleMenu={() => setShowAddMenu((prev) => !prev)}
          showAddMenu={showAddMenu}
        />
        <button
          className="slicer-workspace-objects-panel__secondary-button"
          onClick={() => {
            autoArrange();
            useCADStore
              .getState()
              .setStatusMessage(
                `Auto-arranged ${plateObjects.length} object${plateObjects.length !== 1 ? "s" : ""}`,
              );
          }}
          title="Bin-pack objects on the plate"
          disabled={plateObjects.length === 0}
        >
          <LayoutGrid size={14} /> Auto Arrange
        </button>
        <button
          className="slicer-workspace-objects-panel__danger-button"
          onClick={() => clearPlate()}
          disabled={plateObjects.length === 0}
        >
          <XCircle size={14} /> Clear Plate
        </button>
        <PlateFileActions
          loadInputRef={plateLoadInputRef}
          onLoadPlate={handleLoadPlate}
          onOpenLoad={() => plateLoadInputRef.current?.click()}
          onSaveJson={handleSavePlate}
          onSaveThreeMf={() => void handleSavePlateThreeMf()}
        />
        <CalibrationMenu
          activePrinter={getActivePrinterProfile()}
          activeMaterial={getActiveMaterialProfile()}
          activePrint={getActivePrintProfile()}
        />
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {activeTool && (
        <GeometryToolsModal
          tool={activeTool.tool}
          objectId={activeTool.id}
          onClose={() => setActiveTool(null)}
        />
      )}
    </div>
  );
}
