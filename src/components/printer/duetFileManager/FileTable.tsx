import {
  Download,
  File,
  FileCode,
  FlaskConical,
  Folder,
  Play,
  Pencil,
  Trash2,
} from 'lucide-react';
import { formatFileSize } from '../../../utils/printerFormat';
import type { DuetFileInfo } from '../../../types/duet';
import type { DuetService } from '../../../services/DuetService';
import { SortIcon, formatDate, isEditableFile, isGCodeFile } from './helpers';
import type { SortDir, SortField } from './helpers';
import { ListPlus } from 'lucide-react';
import { GCodeThumbnail } from './GCodeThumbnail';

interface FileTableProps {
  allFilesChecked: boolean;
  checkedFiles: Set<string>;
  currentDirectory: string;
  selectedName: string | null;
  service: DuetService | null;
  sortField: SortField;
  sortDir: SortDir;
  sortedFiles: DuetFileInfo[];
  onSort: (field: SortField) => void;
  onToggleAll: () => void;
  onToggleCheck: (name: string) => void;
  onRowClick: (item: DuetFileInfo) => void | Promise<void>;
  onPrint: (item: DuetFileInfo) => void | Promise<void>;
  onQueue: (item: DuetFileInfo) => void;
  onSimulate: (item: DuetFileInfo) => void | Promise<void>;
  onEdit: (item: DuetFileInfo) => void;
  onDownload: (item: DuetFileInfo) => void | Promise<void>;
  onRename: (item: DuetFileInfo) => void;
  onDelete: (item: DuetFileInfo) => void | Promise<void>;
}

export function FileTable({
  allFilesChecked,
  checkedFiles,
  currentDirectory,
  selectedName,
  service,
  sortField,
  sortDir,
  sortedFiles,
  onSort,
  onToggleAll,
  onToggleCheck,
  onRowClick,
  onPrint,
  onQueue,
  onSimulate,
  onEdit,
  onDownload,
  onRename,
  onDelete,
}: FileTableProps) {
  // Ensure directory path ends without trailing slash for path joining.
  const dirPrefix = currentDirectory.endsWith('/')
    ? currentDirectory.slice(0, -1)
    : currentDirectory;

  return (
    <table className="duet-file-mgr__table">
      <thead>
        <tr>
          <th className="duet-file-mgr__th" style={{ width: 30 }}>
            <input
              type="checkbox"
              className="duet-file-mgr__checkbox"
              checked={allFilesChecked}
              onChange={onToggleAll}
              title="Select all files"
            />
          </th>
          <th className="duet-file-mgr__th" style={{ width: 56 }}></th>
          <th className="duet-file-mgr__th" onClick={() => onSort('name')}>
            <div className="duet-file-mgr__th-content">
              Name <SortIcon field="name" current={sortField} dir={sortDir} />
            </div>
          </th>
          <th className="duet-file-mgr__th" style={{ width: 90 }} onClick={() => onSort('size')}>
            <div className="duet-file-mgr__th-content">
              Size <SortIcon field="size" current={sortField} dir={sortDir} />
            </div>
          </th>
          <th className="duet-file-mgr__th" style={{ width: 160 }} onClick={() => onSort('date')}>
            <div className="duet-file-mgr__th-content">
              Modified <SortIcon field="date" current={sortField} dir={sortDir} />
            </div>
          </th>
          <th className="duet-file-mgr__th duet-file-mgr__th--no-sort" style={{ width: 150 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {sortedFiles.map((item) => {
          const isDir    = item.type === 'd';
          const isSelected = selectedName === item.name;
          const isGCode  = !isDir && isGCodeFile(item.name);
          const filePath = `${dirPrefix}/${item.name}`;

          return (
            <tr
              key={item.name}
              className={`duet-file-mgr__row${isSelected ? ' is-selected' : ''}`}
              onClick={() => onRowClick(item)}
            >
              <td className="duet-file-mgr__td" onClick={(e) => e.stopPropagation()}>
                {!isDir && (
                  <input
                    type="checkbox"
                    className="duet-file-mgr__checkbox"
                    checked={checkedFiles.has(item.name)}
                    onChange={() => onToggleCheck(item.name)}
                  />
                )}
              </td>

              {/* Icon / thumbnail column */}
              <td className="duet-file-mgr__td duet-file-mgr__td--thumb">
                {isDir ? (
                  <Folder size={16} className="duet-file-mgr__icon--dir" />
                ) : isGCode ? (
                  <GCodeThumbnail path={filePath} service={service} />
                ) : (
                  <File size={15} className="duet-file-mgr__icon--file" />
                )}
              </td>

              <td className="duet-file-mgr__td">
                <span className={isDir ? 'duet-file-mgr__name--dir' : 'duet-file-mgr__name--file'}>{item.name}</span>
              </td>
              <td className="duet-file-mgr__td duet-file-mgr__td--muted">
                {isDir ? '--' : formatFileSize(item.size)}
              </td>
              <td className="duet-file-mgr__td duet-file-mgr__td--muted duet-file-mgr__td--small">
                {formatDate(item.date)}
              </td>
              <td className="duet-file-mgr__td" onClick={(e) => e.stopPropagation()}>
                <div className="duet-file-mgr__actions">
                  {isGCode && (
                    <>
                      <button className="duet-file-mgr__action-btn" title="Start print" onClick={() => onPrint(item)}>
                        <Play size={14} className="duet-file-mgr__icon--play" />
                      </button>
                      <button className="duet-file-mgr__action-btn" title="Add to print queue" onClick={() => onQueue(item)}>
                        <ListPlus size={14} className="duet-file-mgr__icon--simulate" />
                      </button>
                      <button className="duet-file-mgr__action-btn" title="Simulate" onClick={() => onSimulate(item)}>
                        <FlaskConical size={14} className="duet-file-mgr__icon--simulate" />
                      </button>
                    </>
                  )}
                  {!isDir && isEditableFile(item.name) && (
                    <button className="duet-file-mgr__action-btn" title="Edit file" onClick={() => onEdit(item)}>
                      <FileCode size={14} className="duet-file-mgr__icon--edit" />
                    </button>
                  )}
                  {!isDir && (
                    <button className="duet-file-mgr__action-btn" title="Download" onClick={() => onDownload(item)}>
                      <Download size={14} className="duet-file-mgr__icon--download" />
                    </button>
                  )}
                  <button className="duet-file-mgr__action-btn" title="Rename" onClick={() => onRename(item)}>
                    <Pencil size={14} />
                  </button>
                  <button className="duet-file-mgr__action-btn" title="Delete" onClick={() => onDelete(item)}>
                    <Trash2 size={14} className="duet-file-mgr__icon--delete" />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
