import { useState } from 'react';
import { X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { colors } from '../../../../utils/theme';
import { PrinterProfileEditor } from './profileEditor/PrinterProfileEditor';
import { MaterialProfileEditor } from './profileEditor/MaterialProfileEditor';
import { PrintProfileEditor } from './profileEditor/PrintProfileEditor';
import { btnAccent } from './profileEditor/shared';
import { ProfileSnapshotDiffPanel } from './ProfileSnapshotDiffPanel';

const titles = {
  printer: 'Printer Profile Editor',
  material: 'Material Profile Editor',
  print: 'Print Profile Editor',
} as const;

export function SlicerProfileEditorModal({
  type,
  onClose,
}: {
  type: 'printer' | 'material' | 'print';
  onClose: () => void;
}) {
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const getActiveMaterialProfile = useSlicerStore((s) => s.getActiveMaterialProfile);
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const updatePrinterProfile = useSlicerStore((s) => s.updatePrinterProfile);
  const updateMaterialProfile = useSlicerStore((s) => s.updateMaterialProfile);
  const updatePrintProfile = useSlicerStore((s) => s.updatePrintProfile);
  const profileSnapshots = useSlicerStore((s) => s.profileSnapshots);
  const restoreProfileSnapshot = useSlicerStore((s) => s.restoreProfileSnapshot);
  const restoreProfileSnapshotKey = useSlicerStore((s) => s.restoreProfileSnapshotKey);

  const printer = getActivePrinterProfile();
  const material = getActiveMaterialProfile();
  const print = getActivePrintProfile();
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.panel,
          border: `1px solid ${colors.panelBorder}`,
          borderRadius: 8,
          width: 720,
          maxWidth: 'calc(100vw - 24px)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: `1px solid ${colors.panelBorder}`,
          }}
        >
          <span style={{ color: colors.text, fontSize: 14, fontWeight: 600 }}>{titles[type]}</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {type === 'printer' && printer && (
          <>
            <PrinterProfileEditor activeTab={activeTab} setActiveTab={setActiveTab} printer={printer} updatePrinterProfile={updatePrinterProfile} />
            <ProfileSnapshotDiffPanel
              kind="printer"
              currentProfile={printer}
              snapshots={profileSnapshots}
              restoreProfileSnapshot={restoreProfileSnapshot}
              restoreProfileSnapshotKey={restoreProfileSnapshotKey}
            />
          </>
        )}
        {type === 'material' && material && (
          <>
            <MaterialProfileEditor activeTab={activeTab} setActiveTab={setActiveTab} material={material} updateMaterialProfile={updateMaterialProfile} />
            <ProfileSnapshotDiffPanel
              kind="material"
              currentProfile={material}
              snapshots={profileSnapshots}
              restoreProfileSnapshot={restoreProfileSnapshot}
              restoreProfileSnapshotKey={restoreProfileSnapshotKey}
            />
          </>
        )}
        {type === 'print' && print && (
          <>
            <PrintProfileEditor activeTab={activeTab} setActiveTab={setActiveTab} print={print} updatePrintProfile={updatePrintProfile} />
            <ProfileSnapshotDiffPanel
              kind="print"
              currentProfile={print}
              snapshots={profileSnapshots}
              restoreProfileSnapshot={restoreProfileSnapshot}
              restoreProfileSnapshotKey={restoreProfileSnapshotKey}
            />
          </>
        )}

        <div
          style={{
            padding: '10px 16px',
            borderTop: `1px solid ${colors.panelBorder}`,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button style={btnAccent} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
