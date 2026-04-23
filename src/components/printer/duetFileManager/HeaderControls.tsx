import { ChevronRight, FolderPlus, Loader2, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import type { RefObject } from 'react';
import { FILE_TABS } from './helpers';

export function HeaderControls({
  activeFileTab,
  batchDeleting,
  breadcrumbs,
  checkedFilesCount,
  fileInputRef,
  handleBatchDelete,
  handleFileChange,
  handleNavigate,
  handleRefresh,
  handleTabSwitch,
  handleUploadClick,
  loading,
  searchQuery,
  setSearchQuery,
  setShowNewFolder,
  uploading,
  uploadProgress,
}: {
  activeFileTab: string;
  batchDeleting: boolean;
  breadcrumbs: { label: string; path: string }[];
  checkedFilesCount: number;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleBatchDelete: () => Promise<void>;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleNavigate: (dir: string) => Promise<void>;
  handleRefresh: () => Promise<void>;
  handleTabSwitch: (tabId: string) => Promise<void>;
  handleUploadClick: () => void;
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  setShowNewFolder: (value: boolean) => void;
  uploading: boolean;
  uploadProgress: number;
}) {
  return (
    <>
      <div className="duet-file-mgr__tab-bar">
        {FILE_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`duet-file-mgr__tab${activeFileTab === tab.id ? ' is-active' : ''}`}
            onClick={() => void handleTabSwitch(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeFileTab === 'sys' && (
        <div className="duet-file-mgr__warning-banner">
          <span className="duet-file-mgr__warning-icon">&#9888;</span>
          Editing system files can affect printer behavior. Be careful.
        </div>
      )}

      <div className="duet-file-mgr__breadcrumbs">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="duet-file-mgr__breadcrumb-wrap">
            {i > 0 && (
              <span className="duet-file-mgr__breadcrumb-sep">
                <ChevronRight size={12} />
              </span>
            )}
            <button
              className={`duet-file-mgr__breadcrumb-item${i === breadcrumbs.length - 1 ? ' is-current' : ''}`}
              onClick={() => void handleNavigate(crumb.path)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      <div className="duet-file-mgr__toolbar">
        <button
          className="duet-file-mgr__toolbar-btn"
          onClick={handleUploadClick}
          disabled={uploading}
          title="Upload file"
        >
          <Upload size={14} />
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={activeFileTab === 'gcodes' ? '.gcode,.g,.nc' : '.g,.gcode,.cfg,.csv,.json,.nc,.bin'}
          multiple
          style={{ display: 'none' }}
          onChange={(event) => void handleFileChange(event)}
        />

        <button
          className="duet-file-mgr__toolbar-btn"
          onClick={() => setShowNewFolder(true)}
          title="New folder"
        >
          <FolderPlus size={14} />
          New Folder
        </button>

        <button
          className="duet-file-mgr__toolbar-btn"
          onClick={() => void handleRefresh()}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          Refresh
        </button>

        {uploading && (
          <div className="duet-file-mgr__progress-container">
            <div className="duet-file-mgr__progress-bar">
              <div className="duet-file-mgr__progress-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="duet-file-mgr__progress-text">{uploadProgress}%</span>
          </div>
        )}

        {checkedFilesCount > 0 && (
          <button
            className="duet-file-mgr__toolbar-btn duet-file-mgr__toolbar-btn--danger"
            onClick={() => void handleBatchDelete()}
            disabled={batchDeleting}
            title="Delete all selected files"
          >
            {batchDeleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            Delete Selected ({checkedFilesCount})
          </button>
        )}
      </div>

      <div className="duet-file-mgr__search-bar">
        <Search size={14} className="duet-file-mgr__search-icon" />
        <input
          className="duet-file-mgr__search-input"
          type="text"
          placeholder="Filter files by name…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {searchQuery && (
          <button
            className="duet-file-mgr__search-clear"
            onClick={() => setSearchQuery('')}
            title="Clear filter"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </>
  );
}
