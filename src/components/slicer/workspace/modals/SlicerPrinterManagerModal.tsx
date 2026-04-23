import { Printer, RefreshCw, X } from 'lucide-react';
import { colors, sharedStyles } from '../../../../utils/theme';
import { ExtruderTab, PrinterTab } from './slicerPrinterManager/tabs';
import { PrinterSidebar } from './slicerPrinterManager/PrinterSidebar';
import { TABS, usePrinterManagerSync } from './slicerPrinterManager/usePrinterManagerSync';

export function SlicerPrinterManagerModal({ onClose }: { onClose: () => void }) {
  const {
    activeDuetId,
    addingName,
    confirmDelete,
    duetPrinters,
    printerConnected,
    printerProfiles,
    selectedDuetId,
    selectedId,
    selectedPrinter,
    showAdd,
    syncError,
    syncing,
    syncStatus,
    tab,
    upd,
    setAddingName,
    setConfirmDelete,
    setSelectedDuetId,
    setShowAdd,
    setTab,
    handleCreate,
    handleDelete,
    handleSelectRow,
    handleSyncFromDuet,
    handleSyncSelected,
    resetAddState,
  } = usePrinterManagerSync();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.panel,
          border: `1px solid ${colors.panelBorder}`,
          borderRadius: 10,
          width: 860,
          height: 640,
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
            padding: '12px 18px',
            flexShrink: 0,
            borderBottom: `1px solid ${colors.panelBorder}`,
            background: `linear-gradient(to bottom, color-mix(in srgb, ${colors.accent} 8%, ${colors.panelLight}), ${colors.panel})`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.text, fontSize: 14, fontWeight: 700 }}>
            <Printer size={16} color={colors.accent} />
            {selectedPrinter?.name ?? 'Manage Printers'}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}`, background: colors.panelLight, flexShrink: 0 }}>
          {TABS.map((tabLabel) => (
            <button
              key={tabLabel}
              onClick={() => setTab(tabLabel)}
              style={{
                padding: '9px 24px',
                fontSize: 13,
                fontWeight: tab === tabLabel ? 700 : 400,
                color: tab === tabLabel ? colors.accent : colors.textDim,
                background: tab === tabLabel ? colors.panel : 'transparent',
                border: 'none',
                borderBottom: `2px solid ${tab === tabLabel ? colors.accent : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              {tabLabel}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <PrinterSidebar
            activeDuetId={activeDuetId}
            addingName={addingName}
            confirmDelete={confirmDelete}
            duetPrinters={duetPrinters}
            printerConnected={printerConnected}
            printerProfiles={printerProfiles}
            selectedDuetId={selectedDuetId}
            selectedId={selectedId}
            showAdd={showAdd}
            syncError={syncError}
            syncing={syncing}
            onAddingNameChange={(value) => {
              setAddingName(value);
            }}
            onCancelAdd={resetAddState}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onSelectDuetId={setSelectedDuetId}
            onSelectPrinter={handleSelectRow}
            onSetConfirmDelete={setConfirmDelete}
            onSetShowAdd={setShowAdd}
            onSyncFromDuet={handleSyncFromDuet}
          />

          {selectedPrinter ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {tab === 'Printer' && <PrinterTab p={selectedPrinter} upd={upd} />}
              {tab === 'Extruder 1' && <ExtruderTab p={selectedPrinter} upd={upd} />}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textDim, fontSize: 13 }}>
              Select a printer to edit
            </div>
          )}
        </div>

        <div
          style={{
            padding: '10px 18px',
            borderTop: `1px solid ${colors.panelBorder}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            {printerConnected && selectedPrinter && (
              <button
                onClick={() => void handleSyncSelected()}
                disabled={syncing}
                title="Re-read config.g from the connected Duet and update this printer + its material and print profiles."
                style={{
                  ...sharedStyles.btnBase,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  opacity: syncing ? 0.6 : 1,
                  cursor: syncing ? 'wait' : 'pointer',
                  color: colors.accent,
                  borderColor: colors.accent,
                }}
              >
                <RefreshCw size={12} className={syncing ? 'spin' : undefined} />
                {syncing ? 'Syncing...' : 'Sync from Duet'}
              </button>
            )}
            {syncError && (
              <div style={{ fontSize: 11, color: '#ef4444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {syncError}
              </div>
            )}
            {!syncError && syncStatus && (
              <div style={{ fontSize: 11, color: colors.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {syncStatus}
              </div>
            )}
          </div>
          <button style={sharedStyles.btnAccent} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
