import type { PrinterProfile } from '../types/slicer';

// Map of setting keys to supported firmware types
// If a setting is not in this map, it's assumed to be universally supported
const FIRMWARE_INCOMPATIBILITIES: Record<string, Set<'marlin' | 'reprap' | 'duet' | 'klipper'>> = {
  // Travel acceleration — Marlin only (M204 P/T)
  travelAccelerationEnabled: new Set(['reprap', 'duet']),
  travelJerkEnabled: new Set(['reprap', 'duet']),
  accelerationTravel: new Set(['reprap', 'duet']),
  jerkTravel: new Set(['reprap', 'duet']),

  // Linear advance — Marlin (M900) and Klipper only
  linearAdvanceEnabled: new Set(['reprap', 'duet']),
  linearAdvanceFactor: new Set(['reprap', 'duet']),

  // Firmware retraction — RepRap/Duet only (G10/G11)
  firmwareRetraction: new Set(['marlin', 'klipper']),

  // Advanced flow rate compensation features
  flowEqualizationRatio: new Set(['reprap', 'duet']),

  // Coasting — Marlin/Klipper only
  coastingEnabled: new Set(['reprap', 'duet']),
  coastingVolume: new Set(['reprap', 'duet']),
  coastingSpeed: new Set(['reprap', 'duet']),

  // Pressure advance / Linear advance (Klipper equivalent)
  // Already covered above but apply to Klipper-specific settings

  // Draft shield — limited on some firmware
  draftShieldEnabled: new Set(['reprap', 'duet']),
  draftShieldDistance: new Set(['reprap', 'duet']),
  draftShieldLimitation: new Set(['reprap', 'duet']),
  draftShieldHeight: new Set(['reprap', 'duet']),
};

export function getFirmwareIncompatibilities(firmware: string): Set<string> {
  const incompatible = new Set<string>();
  for (const [setting, unsupported] of Object.entries(FIRMWARE_INCOMPATIBILITIES)) {
    if (unsupported.has(firmware as any)) {
      incompatible.add(setting);
    }
  }
  return incompatible;
}

export function isSettingSupported(
  settingKey: string,
  printer: PrinterProfile,
): boolean {
  const incompatible = getFirmwareIncompatibilities(printer.gcodeFlavorType);
  return !incompatible.has(settingKey);
}

export function getUnsupportedReason(
  settingKey: string,
  printer: PrinterProfile,
): string | null {
  if (isSettingSupported(settingKey, printer)) return null;

  const firmware = printer.gcodeFlavorType;
  const fw = firmware.charAt(0).toUpperCase() + firmware.slice(1);

  // Provide specific reasons
  if (
    settingKey.includes('travelAcceleration') ||
    settingKey.includes('travelJerk') ||
    settingKey.includes('accelerationTravel') ||
    settingKey.includes('jerkTravel')
  ) {
    return `Travel acceleration/jerk not supported on ${fw}`;
  }

  if (settingKey.includes('linearAdvance')) {
    return `Linear advance (pressure advance) requires Marlin or Klipper`;
  }

  if (settingKey === 'firmwareRetraction') {
    return `Firmware retraction (G10/G11) only supported on RepRap/Duet`;
  }

  if (settingKey.includes('coasting')) {
    return `Coasting not supported on ${fw}`;
  }

  if (settingKey.includes('draftShield')) {
    return `Draft shield not supported on ${fw}`;
  }

  return `Not supported on ${fw}`;
}
