import type { DuetPluginInfo } from '../../../types/duet';
import { errorMessage } from '../persistence';
import type { PrinterStoreApi } from '../storeApi';
import type { PrinterStore } from '../../printerStore';
import { addToast } from '../../toastStore';

export function createFileActions(
  { get, set }: PrinterStoreApi,
): Pick<
  PrinterStore,
  | 'navigateToDirectory'
  | 'refreshFiles'
  | 'uploadFile'
  | 'deleteFile'
  | 'selectFile'
  | 'refreshMacros'
  | 'navigateMacros'
  | 'runMacro'
  | 'createMacro'
  | 'deleteMacro'
  | 'refreshPlugins'
  | 'installPlugin'
  | 'startPlugin'
  | 'stopPlugin'
  | 'uninstallPlugin'
> {
  return {
    navigateToDirectory: async (dir) => {
      const { service } = get(); if (!service) return;
      try { set({ currentDirectory: dir, files: await service.listFiles(dir), selectedFile: null }); }
      catch (err) { set({ error: `Failed to navigate to ${dir}: ${errorMessage(err, 'Unknown error')}` }); }
    },
    refreshFiles: async () => {
      const { service, currentDirectory } = get(); if (!service) return;
      try { set({ files: await service.listFiles(currentDirectory) }); }
      catch (err) { set({ error: `Failed to refresh files: ${errorMessage(err, 'Unknown error')}` }); }
    },
    uploadFile: async (file) => {
      const { service, currentDirectory } = get();
      if (!service) throw new Error('Printer not connected');
      set({ uploading: true, uploadProgress: 0, error: null });
      try {
        await service.uploadFile(`${currentDirectory}/${file.name}`, file, (progress: number) => set({ uploadProgress: progress }));
        set({ uploading: false, uploadProgress: 100 });
        if (get().service === service && get().currentDirectory === currentDirectory) {
          const files = await service.listFiles(currentDirectory);
          const after = get();
          if (after.service === service && after.currentDirectory === currentDirectory) set({ files });
        }
      } catch (err) {
        const message = errorMessage(err, 'Upload failed');
        set({ uploading: false, uploadProgress: 0, error: `Upload failed: ${message}` });
        throw err instanceof Error ? err : new Error(message);
      }
    },
    deleteFile: async (path) => {
      const { service, currentDirectory } = get(); if (!service) return;
      try {
        await service.deleteFile(path);
        const files = await service.listFiles(currentDirectory);
        if (get().currentDirectory === currentDirectory) set({ files });
      } catch (err) { set({ error: `Failed to delete file: ${errorMessage(err, 'Unknown error')}` }); }
    },
    selectFile: async (path) => {
      const { service } = get(); if (!service) return;
      try { set({ selectedFile: await service.getFileInfo(path) }); }
      catch (err) { set({ error: `Failed to get file info: ${errorMessage(err, 'Unknown error')}` }); }
    },
    refreshMacros: async () => {
      const { service, macroPath } = get(); if (!service) return;
      try { set({ macros: await service.listFiles(macroPath) }); }
      catch (err) { set({ error: `Failed to refresh macros: ${errorMessage(err, 'Unknown error')}` }); }
    },
    navigateMacros: async (path) => {
      const { service } = get(); if (!service) return;
      try { set({ macroPath: path, macros: await service.listFiles(path) }); }
      catch (err) { set({ error: `Failed to navigate macros: ${errorMessage(err, 'Unknown error')}` }); }
    },
    runMacro: async (filename) => {
      const { service, macroPath } = get(); if (!service) return;
      try {
        addToast('macro', filename, 'Running macro…');
        await service.sendGCode(`M98 P"${macroPath}/${filename}"`);
      }
      catch (err) { set({ error: `Failed to run macro: ${errorMessage(err, 'Unknown error')}` }); }
    },
    createMacro: async (filename, contents) => {
      const { service, macroPath } = get(); if (!service) return;
      const name = /\.g$/i.test(filename) ? filename : `${filename}.g`;
      try {
        await service.uploadFile(`${macroPath}/${name}`, new Blob([contents], { type: 'text/plain' }));
        const macros = await service.listFiles(macroPath);
        if (get().macroPath === macroPath) set({ macros });
      } catch (err) { set({ error: `Failed to create macro: ${errorMessage(err, 'Unknown error')}` }); }
    },
    deleteMacro: async (filename) => {
      const { service, macroPath } = get(); if (!service) return;
      try {
        await service.deleteFile(`${macroPath}/${filename}`);
        const macros = await service.listFiles(macroPath);
        if (get().macroPath === macroPath) set({ macros });
      } catch (err) { set({ error: `Failed to delete macro: ${errorMessage(err, 'Unknown error')}` }); }
    },
    refreshPlugins: async () => {
      const { service } = get(); if (!service) return;
      set({ pluginsLoading: true });
      try {
        const result = await service.getObjectModel('plugins');
        const raw = (result as { plugins?: Record<string, Record<string, unknown>> }).plugins
          ?? (result as Record<string, Record<string, unknown>>);
        const arr: DuetPluginInfo[] = [];
        if (raw && typeof raw === 'object') {
          for (const [id, value] of Object.entries(raw)) {
            if (!value || typeof value !== 'object') continue;
            arr.push({
              id,
              name: (value.name as string) ?? id,
              version: value.version as string | undefined,
              author: value.author as string | undefined,
              sbcRequired: value.sbcRequired as boolean | undefined,
              rrfVersion: value.rrfVersion as string | undefined,
              dwcVersion: value.dwcVersion as string | undefined,
              pid: typeof value.pid === 'number' ? value.pid : undefined,
              homepage: value.homepage as string | undefined,
            });
          }
        }
        arr.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
        set({ plugins: arr, pluginsLoading: false });
      } catch (err) {
        set({ plugins: [], pluginsLoading: false, error: `Failed to load plugins: ${errorMessage(err, 'Unknown error')}` });
      }
    },
    installPlugin: async (file) => {
      const { service } = get(); if (!service) return;
      try {
        await service.uploadFile(`0:/sys/${file.name}`, file);
        await service.sendGCode(`M750 P"${file.name}"`);
        await get().refreshPlugins();
      } catch (err) { set({ error: `Failed to install plugin: ${errorMessage(err, 'Unknown error')}` }); }
    },
    startPlugin: async (id) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`M751 P"${id}"`);
        await get().refreshPlugins();
      } catch (err) { set({ error: `Failed to start plugin: ${errorMessage(err, 'Unknown error')}` }); }
    },
    stopPlugin: async (id) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`M752 P"${id}"`);
        await get().refreshPlugins();
      } catch (err) { set({ error: `Failed to stop plugin: ${errorMessage(err, 'Unknown error')}` }); }
    },
    uninstallPlugin: async (id) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`M753 P"${id}"`);
        await get().refreshPlugins();
      } catch (err) { set({ error: `Failed to uninstall plugin: ${errorMessage(err, 'Unknown error')}` }); }
    },
    clearSelectedFile: () => set({ selectedFile: null }),
    setUploadProgress: (progress: number) => set({ uploadProgress: progress }),
  };
}
