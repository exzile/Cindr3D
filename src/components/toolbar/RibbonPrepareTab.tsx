import { useState } from 'react';
import {
  Box, AlignCenter, X, MousePointer2,
  Printer, Diamond, Layers, Eye, Download, Settings2,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { useSlicerStore } from '../../store/slicerStore';
import { useComponentStore } from '../../store/componentStore';
import { usePrinterStore } from '../../store/printerStore';
import { DEFAULT_PRINTER_PROFILES } from '../../types/slicer';
import { bodyIdGeometryCache } from '../../store/meshRegistry';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import { SlicerPrinterManagerModal } from '../slicer/workspace/modals/SlicerPrinterManagerModal';

// Prepare ribbon — a single flat row of sections. Previously split across
// four sub-tabs (PLATE / PROFILES / SLICE / EXPORT), they now live side by
// side because the full toolset fits comfortably on one row at the default
// ribbon width.
//
// Printer + Material profile pickers live here too (as dropdowns on their
// respective buttons) so users don't have to dive into the settings panel
// just to swap the active profile — the settings panel is now reserved for
// detailed per-print-profile tweaks.

const ICON_LG = 28;
const ICON_SM = 18;

export function RibbonPrepareTab() {
  const setStatusMessage     = useCADStore((s) => s.setStatusMessage);
  const printerConnected     = usePrinterStore((s) => s.connected);
  const sliceProgress        = useSlicerStore((s) => s.sliceProgress);
  const sliceResult          = useSlicerStore((s) => s.sliceResult);
  const plateObjects         = useSlicerStore((s) => s.plateObjects);
  const previewMode          = useSlicerStore((s) => s.previewMode);
  const printerProfiles      = useSlicerStore((s) => s.printerProfiles);
  const materialProfiles     = useSlicerStore((s) => s.materialProfiles);
  const activePrinterId      = useSlicerStore((s) => s.activePrinterProfileId);
  const activeMaterialId     = useSlicerStore((s) => s.activeMaterialProfileId);

  const [showPrinterModal, setShowPrinterModal] = useState(false);

  const defaultPrinterId = DEFAULT_PRINTER_PROFILES[0]?.id;
  const activePrinterName = printerProfiles.find((p) => p.id === activePrinterId)?.name ?? 'Printer';
  const activeMaterialName = materialProfiles.find((m) => m.id === activeMaterialId)?.name ?? 'Material';

  // Only show materials belonging to the active printer
  const printerMaterials = materialProfiles.filter(
    (m) => (m.printerId ?? defaultPrinterId) === activePrinterId,
  );

  // ── Build plate actions ──────────────────────────────────────────────────
  const allBodies = useComponentStore((s) => s.bodies);
  const addableBodies = Object.values(allBodies).filter((b) => b.visible !== false);

  const sendBodyToPlate = (bodyId: string) => {
    const body = allBodies[bodyId];
    if (!body) return;
    const geomSrc = bodyIdGeometryCache.get(bodyId);
    if (!geomSrc) {
      setStatusMessage('Body geometry not available — try again after the model renders');
      return;
    }
    const geom = geomSrc.clone();
    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    const cx = (bbox.min.x + bbox.max.x) / 2;
    const cy = (bbox.min.y + bbox.max.y) / 2;
    geom.translate(-cx, -cy, -bbox.min.z);
    geom.computeBoundingBox();
    useSlicerStore.getState().addToPlate(bodyId, body.name, geom);
    useCADStore.getState().setWorkspaceMode('prepare');
    setStatusMessage(`Added "${body.name}" to build plate`);
  };

  const handleAddModel = (bodyId?: string) => {
    if (bodyId) {
      sendBodyToPlate(bodyId);
      return;
    }
    if (addableBodies.length === 0) {
      setStatusMessage('No models to add. Create a design first.');
      return;
    }
    sendBodyToPlate(addableBodies[0].id);
  };

  const isSlicing = sliceProgress.stage === 'preparing'
    || sliceProgress.stage === 'slicing'
    || sliceProgress.stage === 'generating';

  const handlePreview = () => {
    const store = useSlicerStore.getState();
    if (store.previewMode === 'preview') {
      store.setPreviewMode('model');
      return;
    }
    if (store.sliceResult) {
      store.setPreviewMode('preview');
      return;
    }
    setStatusMessage('Slicing model for preview...');
    store.startSlice();
  };

  return (
    <>
      <RibbonSection title="BUILD PLATE">
        <ToolButton
          icon={<Box size={ICON_LG} />}
          label="Add Model"
          onClick={() => handleAddModel()}
          disabled={addableBodies.length === 0}
          dropdown={addableBodies.length > 0 ? addableBodies.map((b) => ({
            label: b.name,
            icon: <Box size={12} />,
            onClick: () => handleAddModel(b.id),
          })) : undefined}
          large
          colorClass="icon-blue"
        />
        <div className="ribbon-stack">
          <ToolButton
            icon={<AlignCenter size={ICON_SM} />}
            label="Auto Arrange"
            onClick={() => useSlicerStore.getState().autoArrange()}
            colorClass="icon-blue"
          />
          <ToolButton
            icon={<X size={ICON_SM} />}
            label="Clear Plate"
            onClick={() => useSlicerStore.getState().clearPlate()}
            colorClass="icon-red"
          />
        </div>
      </RibbonSection>

      <RibbonSection title="SELECT">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>

      <RibbonSection title="PROFILES">
        <ToolButton
          icon={<Printer size={ICON_LG} />}
          label={activePrinterName}
          onClick={() => setShowPrinterModal(true)}
          dropdown={[
            ...printerProfiles.map((p) => ({
              label: p.name,
              icon: <Printer size={12} />,
              onClick: () => useSlicerStore.getState().setActivePrinterProfile(p.id),
            })),
            {
              label: 'Manage Printers…',
              icon: <Settings2 size={12} />,
              onClick: () => setShowPrinterModal(true),
              divider: true,
            },
          ]}
          large
          colorClass="icon-blue"
        />
        <ToolButton
          icon={<Diamond size={ICON_LG} />}
          label={activeMaterialName}
          onClick={() => useSlicerStore.getState().setSettingsPanel('material')}
          dropdown={printerMaterials.length > 0 ? printerMaterials.map((m) => ({
            label: m.name,
            icon: <Diamond size={12} />,
            onClick: () => useSlicerStore.getState().setActiveMaterialProfile(m.id),
          })) : undefined}
          large
          colorClass="icon-orange"
        />
      </RibbonSection>

      <RibbonSection title="SLICE">
        <ToolButton
          icon={<Layers size={ICON_LG} />}
          label={isSlicing ? `${Math.round(sliceProgress.percent)}%` : 'Slice'}
          onClick={() => useSlicerStore.getState().startSlice()}
          active={isSlicing}
          disabled={isSlicing}
          large
          colorClass="icon-blue"
        />
        {isSlicing && (
          <ToolButton
            icon={<X size={ICON_LG} />}
            label="Cancel"
            onClick={() => useSlicerStore.getState().cancelSlice()}
            large
            colorClass="icon-red"
          />
        )}
        <ToolButton
          icon={<Eye size={ICON_LG} />}
          label="Preview"
          active={previewMode === 'preview'}
          onClick={handlePreview}
          large
          disabled={isSlicing || plateObjects.length === 0}
          colorClass="icon-green"
        />
      </RibbonSection>

      <RibbonSection title="EXPORT">
        <ToolButton
          icon={<Download size={ICON_LG} />}
          label="Save G-code"
          onClick={() => useSlicerStore.getState().downloadGCode()}
          disabled={!sliceResult}
          large
          colorClass="icon-blue"
        />
        <ToolButton
          icon={<Printer size={ICON_LG} />}
          label="Send to Printer"
          onClick={() => {
            setStatusMessage('Sending G-code to printer…');
            useSlicerStore.getState().sendToPrinter()
              .then(() => setStatusMessage('G-code sent to printer'))
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                setStatusMessage(`Send to printer failed: ${msg}`);
              });
          }}
          disabled={!sliceResult || !printerConnected}
          large
          colorClass="icon-green"
        />
      </RibbonSection>

      {showPrinterModal && <SlicerPrinterManagerModal onClose={() => setShowPrinterModal(false)} />}
    </>
  );
}
