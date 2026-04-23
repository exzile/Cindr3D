import { ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { colors, sharedStyles } from '../../../../../utils/theme';
import type { PrinterProfile } from '../../../../../types/slicer';

interface PrinterSidebarProps {
  activeDuetId: string | null;
  addingName: string;
  confirmDelete: string | null;
  duetPrinters: Array<{ id: string; name: string }>;
  printerConnected: boolean;
  printerProfiles: PrinterProfile[];
  selectedDuetId: string | null;
  selectedId: string;
  showAdd: boolean;
  syncError: string | null;
  syncing: boolean;
  onAddingNameChange: (value: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSelectDuetId: (id: string) => void;
  onSelectPrinter: (id: string) => void;
  onSetConfirmDelete: (id: string | null) => void;
  onSetShowAdd: (show: boolean) => void;
  onSyncFromDuet: () => void;
  onCancelAdd: () => void;
}

export function PrinterSidebar({
  activeDuetId,
  addingName,
  confirmDelete,
  duetPrinters,
  printerConnected,
  printerProfiles,
  selectedDuetId,
  selectedId,
  showAdd,
  syncError,
  syncing,
  onAddingNameChange,
  onCreate,
  onDelete,
  onSelectDuetId,
  onSelectPrinter,
  onSetConfirmDelete,
  onSetShowAdd,
  onSyncFromDuet,
  onCancelAdd,
}: PrinterSidebarProps) {
  return (
    <div
      style={{
        width: 195,
        flexShrink: 0,
        borderRight: `1px solid ${colors.panelBorder}`,
        display: 'flex',
        flexDirection: 'column',
        background: colors.panelLight,
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {printerProfiles.map((printer) => {
          const isSelected = printer.id === selectedId;
          const isConfirming = confirmDelete === printer.id;
          return (
            <div
              key={printer.id}
              onClick={() => onSelectPrinter(printer.id)}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                borderBottom: `1px solid ${colors.panelBorder}`,
                borderLeft: `3px solid ${isSelected ? colors.accent : 'transparent'}`,
                background: isSelected
                  ? `color-mix(in srgb, ${colors.accent} 10%, ${colors.panel})`
                  : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? colors.accent : colors.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {printer.name}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>
                    {printer.buildVolume.x}x{printer.buildVolume.y}x{printer.buildVolume.z} mm
                  </div>
                </div>
                {isSelected && <ChevronRight size={11} color={colors.accent} />}
              </div>

              {isConfirming ? (
                <div style={{ display: 'flex', gap: 4, marginTop: 5 }} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onDelete(printer.id)} style={{ ...sharedStyles.btnDanger, fontSize: 10, padding: '2px 7px' }}>
                    Delete
                  </button>
                  <button onClick={() => onSetConfirmDelete(null)} style={{ ...sharedStyles.btnBase, fontSize: 10, padding: '2px 7px' }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  disabled={printerProfiles.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetConfirmDelete(printer.id);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: colors.textDim,
                    cursor: printerProfiles.length <= 1 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    padding: '2px 0',
                    marginTop: 3,
                    opacity: printerProfiles.length <= 1 ? 0.3 : 1,
                    fontSize: 10,
                    alignItems: 'center',
                    gap: 3,
                  }}
                  onMouseEnter={(e) => {
                    if (printerProfiles.length > 1) e.currentTarget.style.color = '#ef4444';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = colors.textDim;
                  }}
                >
                  <Trash2 size={10} /> Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showAdd ? (
        <div
          style={{
            padding: '8px 10px',
            borderTop: `1px solid ${colors.panelBorder}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <input
            autoFocus
            style={{ ...sharedStyles.input, width: '100%', boxSizing: 'border-box', fontSize: 12 }}
            placeholder="Printer name..."
            value={addingName}
            onChange={(e) => onAddingNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreate();
              if (e.key === 'Escape') onCancelAdd();
            }}
          />

          {printerConnected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 10, color: colors.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Sync from Duet
              </div>
              {duetPrinters.length > 1 && (
                <select
                  value={selectedDuetId ?? activeDuetId ?? ''}
                  onChange={(e) => onSelectDuetId(e.target.value)}
                  style={{ ...sharedStyles.select, width: '100%', fontSize: 11 }}
                >
                  {duetPrinters.map((dp) => (
                    <option key={dp.id} value={dp.id}>
                      {dp.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={onSyncFromDuet}
                disabled={syncing || !addingName.trim()}
                style={{
                  ...sharedStyles.btnBase,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  fontSize: 11,
                  width: '100%',
                  opacity: syncing || !addingName.trim() ? 0.5 : 1,
                  cursor: syncing || !addingName.trim() ? 'not-allowed' : 'pointer',
                  color: colors.accent,
                  borderColor: colors.accent,
                }}
              >
                <RefreshCw size={11} className={syncing ? 'spin' : undefined} />
                {syncing ? 'Reading config.g...' : 'Import from config.g'}
              </button>
              {syncError && <div style={{ fontSize: 10, color: '#ef4444' }}>{syncError}</div>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={onCreate}
              disabled={!addingName.trim()}
              style={{
                ...sharedStyles.btnAccent,
                flex: 1,
                justifyContent: 'center',
                fontSize: 11,
                opacity: addingName.trim() ? 1 : 0.5,
              }}
            >
              Create
            </button>
            <button onClick={onCancelAdd} style={{ ...sharedStyles.btnBase, fontSize: 11 }}>
              x
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => onSetShowAdd(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 12px',
            cursor: 'pointer',
            background: 'transparent',
            border: 'none',
            borderTop: `1px solid ${colors.panelBorder}`,
            color: colors.accent,
            fontSize: 12,
            fontWeight: 500,
            width: '100%',
          }}
        >
          <Plus size={13} /> Add Printer
        </button>
      )}
    </div>
  );
}
