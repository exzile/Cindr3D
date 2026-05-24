import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import * as React from "react";
import { LayoutGrid, XCircle, Layers } from "lucide-react";
import { useSlicerStore } from "../../../../store/slicerStore";
import { errorMessage } from "../../../../utils/errorHandling";
import { useCADStore } from "../../../../store/cadStore";
import { useComponentStore } from "../../../../store/componentStore";
import type { PlateObject } from "../../../../types/slicer";
import { validatePlate } from "../../../../store/slicer/plateValidation";
import { CalibrationMenu } from "../bottom/CalibrationMenu";
import { ContextMenu } from "../ContextMenu";
import { GeometryToolsModal, type GeometryTool } from "../GeometryToolsModal";
import { AddCadMenu } from "./objectsPanel/AddCadMenu";
import { resolveCadBodyGeometry } from "./objectsPanel/addCadBodyToPlate";
import { ImportControls } from "./objectsPanel/ImportControls";
import { ObjectRow } from "./objectsPanel/ObjectRow";
import { PlateFileActions } from "./objectsPanel/PlateFileActions";
import { ValidationSummary } from "./objectsPanel/ValidationSummary";
import { useObjectContextMenu } from "./objectsPanel/useObjectContextMenu";
import { useObjectImportControls } from "./objectsPanel/useObjectImportControls";
import { usePlateObjectRows } from "./objectsPanel/usePlateObjectRows";
import { usePlateObjectTooltips } from "./objectsPanel/usePlateObjectTooltips";
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
  const [colorPickerForId, setColorPickerForId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<{
    tool: GeometryTool;
    id: string;
  } | null>(null);
  const plateLoadInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const colorPickerFrameRef = useRef<number | null>(null);

  const openColorPicker = useCallback((id: string) => {
    setColorPickerForId(id);
    if (colorPickerFrameRef.current !== null) {
      cancelAnimationFrame(colorPickerFrameRef.current);
    }
    colorPickerFrameRef.current = requestAnimationFrame(() => {
      colorPickerFrameRef.current = null;
      colorInputRef.current?.click();
    });
  }, []);

  useEffect(() => () => {
    if (colorPickerFrameRef.current !== null) {
      cancelAnimationFrame(colorPickerFrameRef.current);
    }
  }, []);

  const {
    fileInputRef,
    importError,
    importing,
    isDragging,
    modelUrl,
    handleDragOver,
    handleDrop,
    handleFileInput,
    handleImportUrl,
    openFileDialog,
    setIsDragging,
    setModelUrl,
  } = useObjectImportControls({ importFileToPlate, updatePlateObject });

  const { contextMenu, openContextMenu, setContextMenu } =
    useObjectContextMenu({
      autoOrientPlateObject,
      centerPlateObject,
      dropToBedPlateObject,
      duplicatePlateObject,
      layFlatPlateObject,
      openColorPicker,
      plateObjects,
      removeFromPlate,
      resolveOverlapForObject,
      setActiveTool,
      updatePlateObject,
    });

  const {
    dragRowId,
    handleRowClick,
    handleRowContextMenu,
    handleRowDragOver,
    handleRowDragStart,
    handleRowDrop,
    handleRowKeyDown,
    selectedIds,
    setDragRowId,
  } = usePlateObjectRows({
    additionalSelectedIds,
    openContextMenu,
    plateObjects,
    removeFromPlate,
    reorderPlateObjects,
    selectPlateObject,
    selectPlateObjectRange,
    selectedId,
    togglePlateObjectInSelection,
  });

  const buildRowTooltip = usePlateObjectTooltips(plateObjects);

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

  const handleAddBody = useCallback(
    (bodyId: string, bodyName: string) => {
      const geo = resolveCadBodyGeometry(bodyId, features);
      addToPlate(bodyId, bodyName, geo);
      setShowAddMenu(false);
      setAddSearch("");
    },
    [addToPlate, features],
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
          onOpenFileDialog={openFileDialog}
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
