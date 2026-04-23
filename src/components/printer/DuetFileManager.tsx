import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import './DuetFileManager.css';
import { usePrinterStore } from '../../store/printerStore';
import type { DuetFileInfo } from '../../types/duet';
import DuetFileEditor from './DuetFileEditor';
import { addToQueue } from './jobStatus/printQueueUtils';
import { NewFolderDialog, RenameDialog } from './duetFileManager/dialogs';
import { FILE_TABS, isGCodeFile, sortFiles } from './duetFileManager/helpers';
import type { SortDir, SortField } from './duetFileManager/helpers';
import { HeaderControls } from './duetFileManager/HeaderControls';
import { BrowserBody } from './duetFileManager/BrowserBody';

export default function DuetFileManager() {
  const currentDirectory = usePrinterStore((s) => s.currentDirectory);
  const files = usePrinterStore((s) => s.files);
  const selectedFile = usePrinterStore((s) => s.selectedFile);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const service = usePrinterStore((s) => s.service);
  const connected = usePrinterStore((s) => s.connected);
  const navigateToDirectory = usePrinterStore((s) => s.navigateToDirectory);
  const refreshFiles = usePrinterStore((s) => s.refreshFiles);
  const uploadFile = usePrinterStore((s) => s.uploadFile);
  const deleteFile = usePrinterStore((s) => s.deleteFile);
  const selectFile = usePrinterStore((s) => s.selectFile);
  const startPrint = usePrinterStore((s) => s.startPrint);
  const setError = usePrinterStore((s) => s.setError);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [activeFileTab, setActiveFileTab] = useState<string>('gcodes');
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DuetFileInfo | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);

  const sortedFiles = useMemo(() => {
    const filtered = searchQuery
      ? files.filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : files;
    return sortFiles(filtered, sortField, sortDir);
  }, [files, sortField, sortDir, searchQuery]);

  const currentTabRoot = useMemo(
    () => FILE_TABS.find((tab) => tab.id === activeFileTab)?.directory ?? '0:/gcodes',
    [activeFileTab],
  );

  const breadcrumbs = useMemo(() => {
    const parts = currentDirectory.split('/').filter(Boolean);
    const rootParts = currentTabRoot.split('/').filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];
    let acc = '';

    for (let i = 0; i < parts.length; i += 1) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      if (i < rootParts.length - 1) continue;
      if (i === rootParts.length - 1) {
        const tab = FILE_TABS.find((entry) => entry.id === activeFileTab);
        crumbs.push({ label: tab?.label ?? parts[i], path: acc });
      } else {
        crumbs.push({ label: parts[i], path: acc });
      }
    }

    return crumbs;
  }, [currentDirectory, currentTabRoot, activeFileTab]);

  useEffect(() => {
    if (connected && service) {
      setLoading(true);
      refreshFiles().finally(() => setLoading(false));
    }
  }, [connected, service]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const handleNavigate = useCallback(async (dir: string) => {
    setLoading(true);
    setSelectedName(null);
    try {
      await navigateToDirectory(dir);
    } finally {
      setLoading(false);
    }
  }, [navigateToDirectory]);

  const handleTabSwitch = useCallback(async (tabId: string) => {
    const tab = FILE_TABS.find((entry) => entry.id === tabId);
    if (!tab) return;
    setActiveFileTab(tabId);
    setSelectedName(null);
    setLoading(true);
    try {
      await navigateToDirectory(tab.directory);
    } finally {
      setLoading(false);
    }
  }, [navigateToDirectory]);

  const handleEditFile = useCallback((item: DuetFileInfo) => {
    setEditingFilePath(`${currentDirectory}/${item.name}`);
  }, [currentDirectory]);

  const handleRowClick = useCallback(async (item: DuetFileInfo) => {
    if (item.type === 'd') {
      await handleNavigate(`${currentDirectory}/${item.name}`);
    } else {
      setSelectedName(item.name);
      if (isGCodeFile(item.name)) {
        await selectFile(`${currentDirectory}/${item.name}`);
      }
    }
  }, [currentDirectory, handleNavigate, selectFile]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList) return;
    for (let i = 0; i < fileList.length; i += 1) {
      await uploadFile(fileList[i]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFile]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const droppedFiles = event.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    for (let i = 0; i < droppedFiles.length; i += 1) {
      await uploadFile(droppedFiles[i]);
    }
  }, [uploadFile]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshFiles();
    } finally {
      setLoading(false);
    }
  }, [refreshFiles]);

  const handleNewFolder = useCallback(async (name: string) => {
    if (!service) return;
    setShowNewFolder(false);
    try {
      await service.createDirectory(`${currentDirectory}/${name}`);
      await refreshFiles();
    } catch (err) {
      setError(`Failed to create folder: ${(err as Error).message}`);
    }
  }, [service, currentDirectory, refreshFiles, setError]);

  const handleRename = useCallback(async (newName: string) => {
    if (!service || !renameTarget) return;
    const oldPath = `${currentDirectory}/${renameTarget.name}`;
    const newPath = `${currentDirectory}/${newName}`;
    setRenameTarget(null);
    try {
      await service.moveFile(oldPath, newPath);
      await refreshFiles();
    } catch (err) {
      setError(`Rename failed: ${(err as Error).message}`);
    }
  }, [service, renameTarget, currentDirectory, refreshFiles, setError]);

  const handleDelete = useCallback(async (item: DuetFileInfo) => {
    const path = `${currentDirectory}/${item.name}`;
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await deleteFile(path);
      if (selectedName === item.name) setSelectedName(null);
    } catch (err) {
      setError(`Delete failed: ${(err as Error).message}`);
    }
  }, [currentDirectory, deleteFile, selectedName, setError]);

  const handlePrint = useCallback(async (item: DuetFileInfo) => {
    await startPrint(`${currentDirectory}/${item.name}`);
  }, [currentDirectory, startPrint]);

  const handleQueue = useCallback((item: DuetFileInfo) => {
    addToQueue(`${currentDirectory}/${item.name}`);
  }, [currentDirectory]);

  const handleSimulate = useCallback(async (item: DuetFileInfo) => {
    if (!service) return;
    try {
      await service.simulateFile(`${currentDirectory}/${item.name}`);
    } catch (err) {
      setError(`Simulate failed: ${(err as Error).message}`);
    }
  }, [service, currentDirectory, setError]);

  const handleDownload = useCallback(async (item: DuetFileInfo) => {
    if (!service) return;
    try {
      const blob = await service.downloadFile(`${currentDirectory}/${item.name}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Download failed: ${(err as Error).message}`);
    }
  }, [service, currentDirectory, setError]);

  const handleToggleCheck = useCallback((name: string) => {
    setCheckedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const fileOnlyItems = useMemo(() => sortedFiles.filter((file) => file.type !== 'd'), [sortedFiles]);
  const allFilesChecked = fileOnlyItems.length > 0 && fileOnlyItems.every((file) => checkedFiles.has(file.name));

  const handleToggleAll = useCallback(() => {
    if (allFilesChecked) setCheckedFiles(new Set());
    else setCheckedFiles(new Set(fileOnlyItems.map((file) => file.name)));
  }, [allFilesChecked, fileOnlyItems]);

  const handleBatchDelete = useCallback(async () => {
    const names = Array.from(checkedFiles);
    if (names.length === 0) return;
    if (!confirm(`Delete ${names.length} selected file(s)?`)) return;
    setBatchDeleting(true);
    try {
      for (const name of names) {
        const path = `${currentDirectory}/${name}`;
        try {
          await deleteFile(path);
        } catch (err) {
          setError(`Delete failed for "${name}": ${(err as Error).message}`);
        }
      }
      setCheckedFiles(new Set());
      if (selectedName && names.includes(selectedName)) setSelectedName(null);
    } finally {
      setBatchDeleting(false);
    }
  }, [checkedFiles, currentDirectory, deleteFile, selectedName, setError]);

  useEffect(() => {
    setCheckedFiles(new Set());
  }, [currentDirectory, activeFileTab]);

  return (
    <div className="duet-file-mgr">
      <HeaderControls
        activeFileTab={activeFileTab}
        batchDeleting={batchDeleting}
        breadcrumbs={breadcrumbs}
        checkedFilesCount={checkedFiles.size}
        fileInputRef={fileInputRef}
        handleBatchDelete={handleBatchDelete}
        handleFileChange={handleFileChange}
        handleNavigate={handleNavigate}
        handleRefresh={handleRefresh}
        handleTabSwitch={handleTabSwitch}
        handleUploadClick={handleUploadClick}
        loading={loading}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        setShowNewFolder={setShowNewFolder}
        uploading={uploading}
        uploadProgress={uploadProgress}
      />

      <BrowserBody
        allFilesChecked={allFilesChecked}
        checkedFiles={checkedFiles}
        currentDirectory={currentDirectory}
        dragOver={dragOver}
        handleDelete={handleDelete}
        handleDownload={handleDownload}
        handleDrop={handleDrop}
        handleDragLeave={handleDragLeave}
        handleDragOver={handleDragOver}
        handleEditFile={handleEditFile}
        handlePrint={handlePrint}
        handleQueue={handleQueue}
        handleRowClick={handleRowClick}
        handleSimulate={handleSimulate}
        handleSort={handleSort}
        handleToggleAll={handleToggleAll}
        handleToggleCheck={handleToggleCheck}
        loading={loading}
        searchQuery={searchQuery}
        selectedFile={selectedFile}
        selectedName={selectedName}
        setRenameTarget={setRenameTarget}
        setSelectedName={setSelectedName}
        sortDir={sortDir}
        sortField={sortField}
        sortedFiles={sortedFiles}
      />

      {renameTarget && (
        <RenameDialog
          currentName={renameTarget.name}
          onConfirm={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      {showNewFolder && (
        <NewFolderDialog
          onConfirm={handleNewFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}

      {editingFilePath && (
        <DuetFileEditor
          filePath={editingFilePath}
          onClose={() => {
            setEditingFilePath(null);
            void handleRefresh();
          }}
        />
      )}
    </div>
  );
}
