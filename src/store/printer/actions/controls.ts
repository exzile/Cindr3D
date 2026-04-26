import type { PrinterStore } from '../../printerStore';
import type { PrinterStoreApi } from '../storeApi';
import { parseEventLog } from '../persistence';

export function createControlActions(
  { get, set }: PrinterStoreApi,
): Pick<
  PrinterStore,
  | 'setToolTemp'
  | 'setBedTemp'
  | 'setChamberTemp'
  | 'homeAxes'
  | 'moveAxis'
  | 'extrude'
  | 'setBabyStep'
  | 'setSpeedFactor'
  | 'setExtrusionFactor'
  | 'setGlobalFlowFactor'
  | 'setFanSpeed'
  | 'startPrint'
  | 'pausePrint'
  | 'resumePrint'
  | 'cancelPrint'
  | 'cancelObject'
  | 'emergencyStop'
  | 'refreshFilaments'
  | 'loadFilament'
  | 'unloadFilament'
  | 'changeFilament'
  | 'uploadFirmware'
  | 'installFirmware'
  | 'refreshPrintHistory'
  | 'loadHeightMap'
  | 'probeGrid'
> {
  return {
    setToolTemp: async (tool, _heater, temp) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`G10 P${tool} S${temp}`); }
      catch (err) { set({ error: `Failed to set tool temp: ${(err as Error).message}` }); }
    },
    setBedTemp: async (temp) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M140 S${temp}`); }
      catch (err) { set({ error: `Failed to set bed temp: ${(err as Error).message}` }); }
    },
    setChamberTemp: async (temp) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M141 S${temp}`); }
      catch (err) { set({ error: `Failed to set chamber temp: ${(err as Error).message}` }); }
    },
    homeAxes: async (axes) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(!axes || axes.length === 0 ? 'G28' : `G28 ${axes.join(' ')}`); }
      catch (err) { set({ error: `Failed to home axes: ${(err as Error).message}` }); }
    },
    moveAxis: async (axis, distance) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('G91');
        await service.sendGCode(`G1 ${axis.toUpperCase()}${distance} F6000`);
        await service.sendGCode('G90');
      } catch (err) { set({ error: `Failed to move axis: ${(err as Error).message}` }); }
    },
    extrude: async (amount, feedrate) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('M83');
        await service.sendGCode(`G1 E${amount} F${feedrate}`);
      } catch (err) { set({ error: `Failed to extrude: ${(err as Error).message}` }); }
    },
    setBabyStep: async (offset) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M290 S${offset}`); }
      catch (err) { set({ error: `Failed to set baby step: ${(err as Error).message}` }); }
    },
    setSpeedFactor: async (percent) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M220 S${percent}`); }
      catch (err) { set({ error: `Failed to set speed factor: ${(err as Error).message}` }); }
    },
    setExtrusionFactor: async (extruder, percent) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M221 D${extruder} S${percent}`); }
      catch (err) { set({ error: `Failed to set extrusion factor: ${(err as Error).message}` }); }
    },
    setGlobalFlowFactor: async (percent) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M221 D-1 S${percent}`); }
      catch (err) { set({ error: `Failed to set global flow factor: ${(err as Error).message}` }); }
    },
    setFanSpeed: async (fan, speed) => {
      const { service } = get(); if (!service) return;
      try {
        const duetSpeed = speed > 1 ? speed / 100 : speed;
        await service.sendGCode(`M106 P${fan} S${duetSpeed}`);
      } catch (err) { set({ error: `Failed to set fan speed: ${(err as Error).message}` }); }
    },
    startPrint: async (filename) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M32 "${filename}"`); }
      catch (err) { set({ error: `Failed to start print: ${(err as Error).message}` }); }
    },
    pausePrint: async () => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode('M25'); }
      catch (err) { set({ error: `Failed to pause print: ${(err as Error).message}` }); }
    },
    resumePrint: async () => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode('M24'); }
      catch (err) { set({ error: `Failed to resume print: ${(err as Error).message}` }); }
    },
    cancelPrint: async () => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode('M0'); }
      catch (err) { set({ error: `Failed to cancel print: ${(err as Error).message}` }); }
    },
    cancelObject: async (index) => {
      const { service } = get(); if (!service) return;
      try { await service.cancelObject(index); }
      catch (err) { set({ error: `Failed to cancel object: ${(err as Error).message}` }); }
    },
    emergencyStop: async () => {
      const { service } = get(); if (!service) return;
      try { await service.emergencyStop(); }
      catch (err) { set({ error: `Emergency stop failed: ${(err as Error).message}` }); }
    },
    refreshFilaments: async () => {
      const { service } = get(); if (!service) return;
      try {
        const entries = await service.listFiles('0:/filaments');
        set({ filaments: entries.filter((entry: { type: string }) => entry.type === 'd').map((entry: { name: string }) => entry.name).sort() });
      } catch (err) { set({ error: `Failed to list filaments: ${(err as Error).message}` }); }
    },
    loadFilament: async (toolNumber, name) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`T${toolNumber}`);
        await service.sendGCode(`M701 S"${name}"`);
      } catch (err) { set({ error: `Failed to load filament: ${(err as Error).message}` }); }
    },
    unloadFilament: async (toolNumber) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`T${toolNumber}`);
        await service.sendGCode('M702');
      } catch (err) { set({ error: `Failed to unload filament: ${(err as Error).message}` }); }
    },
    changeFilament: async (toolNumber, name) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`T${toolNumber}`);
        await service.sendGCode('M702');
        await service.sendGCode(`M701 S"${name}"`);
      } catch (err) { set({ error: `Failed to change filament: ${(err as Error).message}` }); }
    },
    uploadFirmware: async (file) => {
      const { service } = get(); if (!service) return;
      set({ uploading: true, uploadProgress: 0, error: null });
      try {
        await service.uploadFile(`0:/firmware/${file.name}`, file, (progress: number) => set({ uploadProgress: progress }));
        set({ uploading: false, uploadProgress: 100 });
      } catch (err) {
        set({ uploading: false, uploadProgress: 0, error: `Firmware upload failed: ${(err as Error).message}` });
        throw err;
      }
    },
    installFirmware: async () => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('M997');
        set({ firmwareUpdatePending: true });
      } catch (err) { set({ error: `Failed to trigger firmware install: ${(err as Error).message}` }); }
    },
    refreshPrintHistory: async () => {
      const { service } = get(); if (!service) return;
      set({ printHistoryLoading: true });
      try {
        const blob = await service.downloadFile('0:/sys/eventlog.txt');
        const text = await blob.text();
        set({ printHistory: parseEventLog(text), printHistoryLoading: false });
      } catch (err) {
        set({ printHistory: [], printHistoryLoading: false, error: `Failed to load print history: ${(err as Error).message}` });
      }
    },
    loadHeightMap: async (path) => {
      const { service } = get(); if (!service) return;
      try { set({ heightMap: await service.getHeightMap(path) }); }
      catch (err) { set({ error: `Failed to load height map: ${(err as Error).message}` }); }
    },
    probeGrid: async () => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('G29');
        set({ heightMap: await service.getHeightMap() });
      } catch (err) { set({ error: `Failed to probe grid: ${(err as Error).message}` }); }
    },
  };
}
