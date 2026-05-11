import { unzipSync } from 'fflate';
import { generateId } from '../../utils/generateId';
import type { PrintProfile } from '../../types/slicer';

export type ExternalProfileFormat = 'cura' | 'orca' | 'bambu' | 'unknown';

export interface ExternalProfileImportResult {
  format: ExternalProfileFormat;
  profile: PrintProfile;
  mappings: Array<{ source: string; target: keyof PrintProfile; value: unknown }>;
  warnings: string[];
}

type RawSettings = Record<string, unknown>;

const NUMBER_FIELDS: Record<string, keyof PrintProfile> = {
  layer_height: 'layerHeight',
  initial_layer_height: 'firstLayerHeight',
  initial_layer_print_height: 'firstLayerHeight',
  wall_loops: 'wallCount',
  wall_line_count: 'wallCount',
  wall_line_width: 'wallLineWidth',
  line_width: 'lineWidth',
  infill_density: 'infillDensity',
  sparse_infill_density: 'infillDensity',
  fill_density: 'infillDensity',
  print_speed: 'printSpeed',
  speed_print: 'printSpeed',
  travel_speed: 'travelSpeed',
  speed_travel: 'travelSpeed',
  initial_layer_speed: 'firstLayerSpeed',
  speed_layer_0: 'firstLayerSpeed',
  outer_wall_speed: 'outerWallSpeed',
  speed_wall_0: 'outerWallSpeed',
  inner_wall_speed: 'wallSpeed',
  speed_wall_x: 'wallSpeed',
  top_surface_speed: 'topSpeed',
  speed_topbottom: 'topSpeed',
  top_shell_layers: 'topLayers',
  top_layers: 'topLayers',
  bottom_shell_layers: 'bottomLayers',
  bottom_layers: 'bottomLayers',
  support_threshold_angle: 'supportAngle',
  support_angle: 'supportAngle',
  support_density: 'supportDensity',
  support_infill_density: 'supportDensity',
  support_top_z_distance: 'supportZDistance',
  support_z_distance: 'supportZDistance',
  support_object_xy_distance: 'supportXYDistance',
  support_xy_distance: 'supportXYDistance',
  skirt_loops: 'skirtLines',
  skirt_line_count: 'skirtLines',
  skirt_distance: 'skirtDistance',
  brim_width: 'brimWidth',
  cool_min_layer_time: 'minLayerTime',
  slow_down_layer_time: 'minLayerTime',
};

const BOOLEAN_FIELDS: Record<string, keyof PrintProfile> = {
  support_enable: 'supportEnabled',
  support_enabled: 'supportEnabled',
  support_material: 'supportEnabled',
  detect_thin_wall: 'thinWallDetection',
  thin_wall_detection: 'thinWallDetection',
  spiral_vase: 'spiralizeContour',
  spiralize: 'spiralizeContour',
};

function profileId(): string {
  return generateId('imported-print');
}

function parseScalar(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/^"|"$/g, '');
  if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed);
  const percent = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percent) return Number(percent[1]);
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function flattenSettings(value: unknown, output: RawSettings = {}): RawSettings {
  if (!value || typeof value !== 'object') return output;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = item as Record<string, unknown>;
      if ('value' in nested && (!nested.value || typeof nested.value !== 'object' || Array.isArray(nested.value))) {
        output[key] = parseScalar(nested.value);
      }
      flattenSettings(nested, output);
    } else {
      output[key] = parseScalar(item);
    }
  }
  return output;
}

function parseKeyValueText(text: string): RawSettings {
  const settings: RawSettings = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || /^\[.+\]$/.test(trimmed)) continue;
    const match = trimmed.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (match) settings[match[1].trim()] = parseScalar(match[2]);
  }
  return settings;
}

function detectFormat(name: string, settings: RawSettings): ExternalProfileFormat {
  const lower = name.toLowerCase();
  const keys = Object.keys(settings).join(' ');
  if (lower.endsWith('.curaprofile') || keys.includes('speed_print') || keys.includes('machine_name')) return 'cura';
  if (lower.includes('bambu') || keys.includes('enable_prime_tower') || keys.includes('filament_settings_id')) return 'bambu';
  if (lower.includes('orca') || keys.includes('sparse_infill_density') || keys.includes('wall_loops')) return 'orca';
  return 'unknown';
}

function normalizeInfillPattern(value: unknown): PrintProfile['infillPattern'] | undefined {
  const pattern = String(value ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (pattern === 'rectilinear' || pattern === 'aligned_rectilinear') return 'lines';
  if (pattern === '3d_honeycomb') return 'honeycomb';
  const allowed: PrintProfile['infillPattern'][] = ['grid', 'lines', 'triangles', 'cubic', 'gyroid', 'honeycomb', 'lightning', 'organic', 'concentric', 'cross', 'cross3d', 'quarter_cubic', 'octet', 'tri_hexagon', 'zigzag', 'tetrahedral', 'cubicsubdiv'];
  return allowed.includes(pattern as PrintProfile['infillPattern']) ? pattern as PrintProfile['infillPattern'] : undefined;
}

function normalizeSupportType(value: unknown): PrintProfile['supportType'] | undefined {
  const support = String(value ?? '').toLowerCase();
  if (support.includes('tree')) return 'tree';
  if (support.includes('organic')) return 'organic';
  if (support) return 'normal';
  return undefined;
}

function normalizeAdhesion(value: unknown): PrintProfile['adhesionType'] | undefined {
  const adhesion = String(value ?? '').toLowerCase();
  if (adhesion.includes('brim') || adhesion.includes('outer_only') || adhesion.includes('inner_only')) return 'brim';
  if (adhesion.includes('raft')) return 'raft';
  if (adhesion.includes('skirt')) return 'skirt';
  if (adhesion.includes('none') || adhesion.includes('no_brim')) return 'none';
  return undefined;
}

function sourceName(settings: RawSettings, fallback: string): string {
  const raw = settings.name ?? settings.profile_name ?? settings.print_settings_id ?? settings.setting_version;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback.replace(/\.[^.]+$/, '');
}

export function parseExternalPrintProfile(name: string, text: string, baseProfile: PrintProfile): ExternalProfileImportResult {
  let settings: RawSettings;
  try {
    settings = flattenSettings(JSON.parse(text));
  } catch {
    settings = parseKeyValueText(text);
  }

  const format = detectFormat(name, settings);
  const profile: PrintProfile = {
    ...baseProfile,
    id: profileId(),
    name: `${sourceName(settings, name)} (Imported)`,
    machineSourcedFields: [],
  };
  const mappings: ExternalProfileImportResult['mappings'] = [];
  const warnings: string[] = [];

  for (const [source, target] of Object.entries(NUMBER_FIELDS)) {
    const value = settings[source];
    if (typeof value === 'number' && Number.isFinite(value)) {
      (profile as unknown as Record<string, unknown>)[target] = value;
      mappings.push({ source, target, value });
    }
  }
  for (const [source, target] of Object.entries(BOOLEAN_FIELDS)) {
    const value = settings[source];
    if (typeof value === 'boolean') {
      (profile as unknown as Record<string, unknown>)[target] = value;
      mappings.push({ source, target, value });
    }
  }

  const infillPattern = normalizeInfillPattern(settings.sparse_infill_pattern ?? settings.infill_pattern ?? settings.fill_pattern);
  if (infillPattern) {
    profile.infillPattern = infillPattern;
    mappings.push({ source: 'infill pattern', target: 'infillPattern', value: infillPattern });
  }
  const supportType = normalizeSupportType(settings.support_type ?? settings.support_style);
  if (supportType) {
    profile.supportType = supportType;
    mappings.push({ source: 'support type', target: 'supportType', value: supportType });
  }
  const adhesionType = normalizeAdhesion(settings.brim_type ?? settings.adhesion_type ?? settings.platform_adhesion);
  if (adhesionType) {
    profile.adhesionType = adhesionType;
    mappings.push({ source: 'adhesion', target: 'adhesionType', value: adhesionType });
  }

  if (mappings.length === 0) warnings.push('No recognized print-profile settings were found.');
  if (format === 'unknown') warnings.push('The source format was not recognized; imported fields were matched by setting names.');
  return { format, profile, mappings, warnings };
}

export async function parseExternalPrintProfileFile(file: File, baseProfile: PrintProfile): Promise<ExternalProfileImportResult> {
  if (file.name.toLowerCase().endsWith('.3mf')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = unzipSync(bytes);
    const candidate = Object.entries(entries).find(([path]) => /config|setting|profile/i.test(path) && /\.(json|ini|config|txt)$/i.test(path));
    if (!candidate) return parseExternalPrintProfile(file.name, '', baseProfile);
    return parseExternalPrintProfile(file.name, new TextDecoder().decode(candidate[1]), baseProfile);
  }
  return parseExternalPrintProfile(file.name, await file.text(), baseProfile);
}
