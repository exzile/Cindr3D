import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { colors } from '../../../../utils/theme';
import { parseExternalPrintProfileFile, type ExternalProfileImportResult } from '../../../../services/integrations/externalProfileImport';
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
  const addPrintProfile = useSlicerStore((s) => s.addPrintProfile);
  const setActivePrintProfile = useSlicerStore((s) => s.setActivePrintProfile);
  const profileSnapshots = useSlicerStore((s) => s.profileSnapshots);
  const restoreProfileSnapshot = useSlicerStore((s) => s.restoreProfileSnapshot);
  const restoreProfileSnapshotKey = useSlicerStore((s) => s.restoreProfileSnapshotKey);

  const printer = getActivePrinterProfile();
  const material = getActiveMaterialProfile();
  const print = getActivePrintProfile();
  const [activeTab, setActiveTab] = useState(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importResult, setImportResult] = useState<ExternalProfileImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImportProfile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !print) return;
    setImportError(null);
    try {
      setImportResult(await parseExternalPrintProfileFile(file, print));
    } catch (error) {
      setImportResult(null);
      setImportError(error instanceof Error ? error.message : 'Could not import profile.');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleConfirmImport = () => {
    if (!importResult) return;
    addPrintProfile(importResult.profile);
    setActivePrintProfile(importResult.profile.id);
    setImportResult(null);
  };

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
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${colors.panelBorder}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <div style={{ color: colors.textDim, fontSize: 12 }}>Import Cura, OrcaSlicer, Bambu Studio, or 3MF profile settings into a new print profile.</div>
                <button
                  style={{ ...btnAccent, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                  onClick={() => importInputRef.current?.click()}
                >
                  <Upload size={13} /> Import
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".curaprofile,.json,.ini,.config,.txt,.3mf"
                  style={{ display: 'none' }}
                  onChange={(event) => void handleImportProfile(event.target.files)}
                />
              </div>
              {importError && <div style={{ color: '#ef4444', fontSize: 12 }}>{importError}</div>}
              {importResult && (
                <div style={{ border: `1px solid ${colors.panelBorder}`, borderRadius: 8, padding: 10, background: colors.panelLight, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div style={{ color: colors.text, fontSize: 12 }}>
                      {importResult.profile.name} - {importResult.format.toUpperCase()} - {importResult.mappings.length} mapped settings
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={{ ...btnAccent, fontSize: 12 }} onClick={handleConfirmImport}>Confirm Import</button>
                      <button style={{ background: 'transparent', border: `1px solid ${colors.panelBorder}`, color: colors.textDim, borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }} onClick={() => setImportResult(null)}>Cancel</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6, maxHeight: 84, overflow: 'auto' }}>
                    {importResult.mappings.slice(0, 12).map((mapping) => (
                      <div key={`${mapping.source}-${String(mapping.target)}`} style={{ fontSize: 11, color: colors.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {mapping.source}{' -> '}{String(mapping.target)}: {String(mapping.value)}
                      </div>
                    ))}
                  </div>
                  {importResult.warnings.map((warning) => (
                    <div key={warning} style={{ color: '#f59e0b', fontSize: 11 }}>{warning}</div>
                  ))}
                </div>
              )}
            </div>
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
