import { Loader2, Upload } from 'lucide-react';
import type { DuetFileInfo, DuetGCodeFileInfo } from '../../../types/duet';
import { usePrinterStore } from '../../../store/printerStore';
import { FileInfoPanel } from './FileInfoPanel';
import { FileTable } from './FileTable';

export function BrowserBody({
  allFilesChecked,
  checkedFiles,
  currentDirectory,
  dragOver,
  handleDelete,
  handleDownload,
  handleDrop,
  handleDragLeave,
  handleDragOver,
  handleEditFile,
  handlePrint,
  handleQueue,
  handleRowClick,
  handleSimulate,
  handleSort,
  handleToggleAll,
  handleToggleCheck,
  loading,
  searchQuery,
  selectedFile,
  selectedName,
  setRenameTarget,
  setSelectedName,
  sortDir,
  sortField,
  sortedFiles,
}: {
  allFilesChecked: boolean;
  checkedFiles: Set<string>;
  currentDirectory: string;
  dragOver: boolean;
  handleDelete: (item: DuetFileInfo) => Promise<void>;
  handleDownload: (item: DuetFileInfo) => Promise<void>;
  handleDrop: (event: React.DragEvent) => Promise<void>;
  handleDragLeave: (event: React.DragEvent) => void;
  handleDragOver: (event: React.DragEvent) => void;
  handleEditFile: (item: DuetFileInfo) => void;
  handlePrint: (item: DuetFileInfo) => Promise<void>;
  handleQueue: (item: DuetFileInfo) => void;
  handleRowClick: (item: DuetFileInfo) => Promise<void>;
  handleSimulate: (item: DuetFileInfo) => Promise<void>;
  handleSort: (field: 'name' | 'size' | 'date') => void;
  handleToggleAll: () => void;
  handleToggleCheck: (name: string) => void;
  loading: boolean;
  searchQuery: string;
  selectedFile: DuetGCodeFileInfo | null;
  selectedName: string | null;
  setRenameTarget: (item: DuetFileInfo | null) => void;
  setSelectedName: (name: string | null) => void;
  sortDir: 'asc' | 'desc';
  sortField: 'name' | 'size' | 'date';
  sortedFiles: DuetFileInfo[];
}) {
  return (
    <div className="duet-file-mgr__body">
      <div
        className="duet-file-mgr__file-list"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => void handleDrop(event)}
      >
        {dragOver && (
          <div className="duet-file-mgr__drop-overlay">
            <Upload size={32} className="duet-file-mgr__drop-icon" />
            Drop files to upload
          </div>
        )}

        {loading ? (
          <div className="duet-file-mgr__loading">
            <Loader2 size={18} className="spin" />
            Loading...
          </div>
        ) : sortedFiles.length === 0 ? (
          <div className="duet-file-mgr__empty">
            {searchQuery ? `No files matching "${searchQuery}"` : 'This folder is empty'}
          </div>
        ) : (
          <FileTable
            allFilesChecked={allFilesChecked}
            checkedFiles={checkedFiles}
            currentDirectory={currentDirectory}
            selectedName={selectedName}
            sortField={sortField}
            sortDir={sortDir}
            sortedFiles={sortedFiles}
            onSort={handleSort}
            onToggleAll={handleToggleAll}
            onToggleCheck={handleToggleCheck}
            onRowClick={(item) => void handleRowClick(item)}
            onPrint={(item) => void handlePrint(item)}
            onQueue={handleQueue}
            onSimulate={(item) => void handleSimulate(item)}
            onEdit={handleEditFile}
            onDownload={(item) => void handleDownload(item)}
            onRename={setRenameTarget}
            onDelete={(item) => void handleDelete(item)}
          />
        )}
      </div>

      {selectedFile && (
        <FileInfoPanel
          fileInfo={selectedFile}
          onClose={() => {
            setSelectedName(null);
            usePrinterStore.setState({ selectedFile: null });
          }}
        />
      )}
    </div>
  );
}
