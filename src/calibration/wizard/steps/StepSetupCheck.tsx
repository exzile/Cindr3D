import { useEffect, useMemo } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Wifi } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';

interface StepSetupCheckProps {
  printerId: string;
  testType: string;
}

interface CheckRow {
  label: string;
  value: string;
  status: 'ok' | 'warn' | 'fail';
}

const STATUS_ICON = {
  ok:   <CheckCircle size={14} style={{ color: '#22c55e' }} />,
  warn: <AlertTriangle size={14} style={{ color: '#f59e0b' }} />,
  fail: <XCircle size={14} style={{ color: '#ef4444' }} />,
};

function firmwareLabel(boardType: string | undefined, version?: string): string {
  const base = (() => {
    switch (boardType) {
      case 'duet':      return 'Duet / RepRapFirmware';
      case 'klipper':   return 'Klipper';
      case 'marlin':    return 'Marlin';
      case 'smoothie':  return 'Smoothieware';
      case 'reprap':    return 'RepRapFirmware';
      case 'grbl':      return 'GRBL';
      case 'repetier':  return 'Repetier';
      case 'other':     return 'Other';
      default:          return boardType ?? 'Unknown';
    }
  })();
  return version ? `${base} v${version}` : base;
}

/** Infer a boardType string from the firmware name reported by the live board. */
function detectBoardType(firmwareName: string): string | null {
  const lower = firmwareName.toLowerCase();
  if (lower.includes('reprap')) return 'duet';
  if (lower.includes('klipper')) return 'klipper';
  if (lower.includes('marlin')) return 'marlin';
  if (lower.includes('smoothie')) return 'smoothie';
  if (lower.includes('grbl')) return 'grbl';
  if (lower.includes('repetier')) return 'repetier';
  return null;
}

export function StepSetupCheck({ printerId, testType }: StepSetupCheckProps) {
  const printers        = usePrinterStore((s) => s.printers);
  const connected       = usePrinterStore((s) => s.connected);
  const setConfig       = usePrinterStore((s) => s.setConfig);
  // The live connection config is the ground truth for board type.
  const liveBoardType   = usePrinterStore((s) => s.config.boardType);
  const model           = usePrinterStore((s) => s.model);
  const activeProfile   = useSlicerStore((s) => s.getActivePrinterProfile());

  const selectedPrinter = printers.find((p) => p.id === printerId);

  // Live board object (populated by the RRF/Duet object model poll).
  type LiveBoard = { firmwareName?: string; firmwareVersion?: string };
  const liveBoard = ((model as { boards?: LiveBoard[] }).boards ?? [])[0] as LiveBoard | undefined;
  const liveFirmwareVersion = liveBoard?.firmwareVersion;

  // Prefer the live connection's boardType; fall back to the saved config.
  // Default to 'duet' (same as the Settings page) — this app targets Duet/RRF
  // and a new printer config never includes an explicit boardType until the user
  // changes it, so 'unknown' would be misleading.
  const boardType = liveBoardType ?? selectedPrinter?.config.boardType ?? 'duet';

  // Auto-detect and persist boardType when the live firmware name reveals it
  // but no boardType is saved yet (e.g. fresh printer config).
  useEffect(() => {
    if (liveBoardType || !liveBoard?.firmwareName) return;
    const detected = detectBoardType(liveBoard.firmwareName);
    if (detected) setConfig({ boardType: detected as import('../../../types/duet').PrinterBoardType });
  }, [liveBoardType, liveBoard?.firmwareName, setConfig]);

  // Pull live heater data from RRF object model (Duet) or synthesised printerStore model.
  const hotendActual  = (model as { heat?: { heaters?: Array<{ current?: number }> } }).heat?.heaters?.[1]?.current;
  const bedActual     = (model as { heat?: { heaters?: Array<{ current?: number }> } }).heat?.heaters?.[0]?.current;

  const checks = useMemo<CheckRow[]>(() => [
    {
      label: 'Firmware',
      value: firmwareLabel(boardType, liveFirmwareVersion),
      status: 'ok',
    },
    {
      label: 'Connection',
      value: connected ? 'Connected' : 'Not connected',
      status: connected ? 'ok' : 'fail',
    },
    {
      label: 'Nozzle capacity',
      value: `${activeProfile.maxNozzleTemp} °C max`,
      status: activeProfile.maxNozzleTemp >= 200 ? 'ok' : 'warn',
    },
    {
      label: 'Bed capacity',
      value: activeProfile.hasHeatedBed
        ? `${activeProfile.maxBedTemp} °C max`
        : 'No heated bed',
      status: activeProfile.hasHeatedBed ? 'ok' : 'warn',
    },
    ...(hotendActual !== undefined ? [{
      label: 'Hotend temperature',
      value: `${hotendActual.toFixed(1)} °C`,
      status: (hotendActual < 50 ? 'ok' : 'warn') as CheckRow['status'],
    }] : []),
    ...(bedActual !== undefined ? [{
      label: 'Bed temperature',
      value: `${bedActual.toFixed(1)} °C`,
      status: (bedActual < 50 ? 'ok' : 'warn') as CheckRow['status'],
    }] : []),
    {
      label: 'Nozzle diameter',
      value: `${activeProfile.nozzleDiameter.toFixed(2)} mm`,
      status: 'ok',
    },
    {
      label: 'Build volume',
      value: `${activeProfile.buildVolume.x} × ${activeProfile.buildVolume.y} × ${activeProfile.buildVolume.z} mm`,
      status: 'ok',
    },
  ], [boardType, liveFirmwareVersion, connected, activeProfile, hotendActual, bedActual]);

  const allOk  = checks.every((c) => c.status === 'ok');
  const hasFail = checks.some((c) => c.status === 'fail');

  return (
    <div className="calib-step">

      <p>Verifying your printer configuration before running the {testType.replace(/-/g, ' ')} calibration.</p>

      <div className="calib-step__checklist">
        {checks.map((row) => (
          <div key={row.label} className="calib-step__check-row">
            {STATUS_ICON[row.status]}
            <span className="calib-step__check-label">{row.label}</span>
            <span className="calib-step__check-value">{row.value}</span>
          </div>
        ))}
      </div>

      {!connected && (
        <div className="calib-step__warning">
          <Wifi size={14} /> Not connected — connect from the Printer → Settings tab before continuing.
        </div>
      )}
      {connected && allOk && (
        <div className="calib-step__ok-banner">
          <CheckCircle size={14} /> All checks passed — ready to proceed.
        </div>
      )}
      {hasFail && !allOk && (
        <div className="calib-step__warning">
          <AlertTriangle size={14} /> Fix the failing checks before running calibration.
        </div>
      )}
    </div>
  );
}
