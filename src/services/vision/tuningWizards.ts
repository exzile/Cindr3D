import type { VisionFrameSample, VisionPrinterSnapshot, VisionProviderConfig } from './failureDetector';

export type TuningWizardKind =
  | 'pressure-advance'
  | 'retraction'
  | 'temperature'
  | 'first-layer-squish'
  | 'input-shaper'
  | 'firmware-health'
  | 'flow-rate'
  | 'dimensional-accuracy'
  | 'max-volumetric-speed';

export interface TuningTowerContext {
  kind: TuningWizardKind;
  printer: VisionPrinterSnapshot;
  /** Numeric value at the bottom of the tower (e.g. PA at startZ). */
  startValue?: number;
  /** Numeric increase per mm of Z height — used to map a band height to a value. */
  stepPerMm?: number;
  /** Effective Z span (endZ - startZ) the tuning ramp covers, in mm. */
  towerHeightMm?: number;
  axis?: 'X' | 'Y';
  material?: unknown;
  operatorNotes?: string[];
}

export interface AnalyzeTuningTowerInput {
  frames: VisionFrameSample[];
  context: TuningTowerContext;
  provider: VisionProviderConfig;
}

export interface TuningTowerRecommendation {
  kind: TuningWizardKind;
  bestValue?: number;
  bestHeightMm?: number;
  confidence: number;
  summary: string;
  evidence: string[];
  suggestedActions: string[];
  missingMeasurements?: string[];
  settingTweaks?: Array<{ tool: string; args: Record<string, unknown>; label: string }>;
  rawText?: string;
}

export interface TuningRecommendationReportInput {
  recommendation: TuningTowerRecommendation;
  context: TuningTowerContext;
  measurements?: Record<string, number>;
  frames?: VisionFrameSample[];
  generatedAt?: number;
}

export interface TuningRecommendationReport {
  title: string;
  generatedAt: number;
  kind: TuningWizardKind;
  recommendedValue: number | null;
  confidencePct: number;
  summary: string;
  evidence: string[];
  missingMeasurements: string[];
  suggestedActions: string[];
  measurements: Record<string, number>;
  frameCount: number;
  markdown: string;
}

function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl);
  if (!match) throw new Error('Tuning frame must be a base64 data URL.');
  return { mimeType: match[1], base64: match[2] };
}

export function pressureAdvanceValueFromHeight(heightMm: number, startValue = 0, stepPerMm = 0.005): number {
  return Number((startValue + heightMm * stepPerMm).toFixed(4));
}

function kindGuidance(kind: TuningWizardKind): string[] {
  switch (kind) {
    case 'pressure-advance':
      return [
        'Pressure advance: inspect corners and extrusion transitions; prefer the lowest value with sharp corners and no gaps.',
        'When a height band is visible, return bestHeightMm and compute bestValue from startValue and stepPerMm.',
      ];
    case 'retraction':
      return [
        'Retraction tower: each band prints the same travel-heavy hop at a different retraction distance.',
        'When startValue/stepPerMm/towerHeightMm are provided the tower ramps retraction linearly over Z — return bestHeightMm at the cleanest band and compute bestValue = startValue + bestHeightMm * stepPerMm.',
        'Score the travels (not the tower walls) for stringing, blobs, and under-extrusion at the start of the next move.',
        'Prefer the lowest retraction distance that produces clean travels — too much retraction shows as under-extrusion at travel ends.',
        'bestValue is retraction distance in millimeters (typically 0.2 - 6 mm; direct drive uses small values, Bowden uses larger).',
      ];
    case 'temperature':
      return [
        'Temperature tower: each band prints at a different nozzle temperature, hotter at the bottom and cooler toward the top.',
        'When startValue/stepPerMm/towerHeightMm are provided the temperature steps linearly over Z — return bestHeightMm at the cleanest band and compute bestValue = startValue + bestHeightMm * stepPerMm.',
        'Compare bridges, overhangs, stringing, surface finish, and inter-layer bonding across bands; the best band balances bridging quality (favours hotter) with stringing/sag (favours cooler).',
        'bestValue is nozzle temperature in degrees Celsius — round to the nearest integer (no fractional degrees).',
      ];
    case 'first-layer-squish':
      return [
        'First layer: inspect line contact, gaps, ridges, elephant-foot risk, and adhesion.',
        'bestValue is the Z-offset delta in millimeters; negative means closer to the bed.',
      ];
    case 'input-shaper':
      return [
        'Input shaper: identify ringing frequency bands per axis; bestValue may be the dominant frequency when only one axis is visible.',
        'Use evidence to say which axis is supported by the frame.',
      ];
    case 'flow-rate':
      return [
        'Flow rate: compare wall thickness, top-surface closure, and corner bulging; bestValue is flow percent.',
      ];
    case 'dimensional-accuracy':
      return [
        'Dimensional accuracy: compare measured dimensions with nominal dimensions; bestValue is dimensional error in millimeters.',
      ];
    case 'max-volumetric-speed':
      return [
        'Max volumetric speed: the test is a single-wall vase printed with a continuous feed-rate ramp (M220 percent) over Z.',
        'When startValue/stepPerMm/towerHeightMm are provided the percent steps linearly over Z; return bestHeightMm at the LAST clean Z (just below the height where the wall first turns rough or gappy).',
        'Inspect the wall for under-extrusion lines, gaps, or rough texture — these mark the point the hot-end could no longer melt filament fast enough.',
        'Operator notes carry the base print speed (mm/s) and line width — convert the bestHeightMm into a feed-rate percent, then percent * baseSpeed * lineWidth * layerHeight = mm3/s; report bestValue in mm3/s with one decimal.',
      ];
    case 'firmware-health':
      return [
        'Firmware health: summarize visible risk only; omit bestValue unless a numeric corrective value is directly measured.',
      ];
    default:
      return [];
  }
}

export function buildTuningPrompt(input: AnalyzeTuningTowerInput): string {
  const crossFrameLines = input.frames.length > 1
    ? [
        `You will see ${input.frames.length} camera frames of the SAME print. Treat them as complementary views — look for observations that AGREE across frames and weight those higher in your evidence.`,
        'If observations DISAGREE across frames (e.g. one shows good corners and another shows bulge), say so in evidence and LOWER confidence rather than guessing.',
      ]
    : [];
  return [
    'You are Cindr3D auto-tune vision analysis. Analyze calibration tower camera frames and recommend only the measured setting.',
    'The printer remains under operator control; do not claim to start, stop, or modify the printer.',
    'Return only compact JSON with keys: kind, bestValue, bestHeightMm, confidence, summary, evidence, missingMeasurements, suggestedActions, settingTweaks.',
    'Evidence must cite visible observations from the provided images or explicit operator measurements.',
    'If the image is ambiguous, ask for the missing measurement in missingMeasurements and lower confidence instead of guessing.',
    'Keep confidence separate from the recommended value: confidence is 0..1, bestValue is the final numeric recommendation only when supported.',
    'For pressure-advance, bestValue = startValue + bestHeightMm * stepPerMm when a best height is visible.',
    'For first-layer-squish, bestValue is suggested Z-offset delta in millimeters.',
    ...crossFrameLines,
    ...kindGuidance(input.context.kind),
    'settingTweaks may include safe app tools such as slicer_set_material_setting, slicer_set_setting, printer_set_baby_step, printer_set_speed_factor, printer_set_flow_factor, or printer_set_fan_speed.',
    `Context: ${JSON.stringify(input.context)}`,
  ].join('\n');
}

function reportTitle(kind: TuningWizardKind): string {
  switch (kind) {
    case 'pressure-advance': return 'Pressure Advance Recommendation';
    case 'retraction': return 'Retraction Recommendation';
    case 'temperature': return 'Temperature Tower Recommendation';
    case 'first-layer-squish': return 'First Layer Recommendation';
    case 'input-shaper': return 'Input Shaper Recommendation';
    case 'firmware-health': return 'Firmware Health Report';
    case 'flow-rate': return 'Flow Rate Recommendation';
    case 'dimensional-accuracy': return 'Dimensional Accuracy Report';
    case 'max-volumetric-speed': return 'Max Volumetric Speed Recommendation';
    default: return 'Calibration Recommendation';
  }
}

function formatReportList(items: string[], fallback: string): string {
  if (items.length === 0) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join('\n');
}

export function buildTuningRecommendationReport({
  recommendation,
  context,
  measurements = {},
  frames = [],
  generatedAt = Date.now(),
}: TuningRecommendationReportInput): TuningRecommendationReport {
  const title = reportTitle(recommendation.kind);
  const confidencePct = Math.round(Math.min(1, Math.max(0, recommendation.confidence)) * 100);
  const recommendedValue = recommendation.bestValue ?? null;
  const missingMeasurements = recommendation.missingMeasurements ?? [];
  const measurementLines = Object.entries(measurements).map(([key, value]) => `- ${key}: ${value}`);
  const markdown = [
    `# ${title}`,
    '',
    `Printer: ${context.printer.printerName}`,
    `Kind: ${recommendation.kind}`,
    `Recommended value: ${recommendedValue ?? 'manual review required'}`,
    `Confidence: ${confidencePct}%`,
    `Frames reviewed: ${frames.length}`,
    '',
    '## Summary',
    recommendation.summary,
    '',
    '## Evidence',
    formatReportList(recommendation.evidence, 'No visual evidence was returned.'),
    '',
    '## Measurements',
    measurementLines.length > 0 ? measurementLines.join('\n') : '- No manual measurements recorded.',
    '',
    '## Missing Measurements',
    formatReportList(missingMeasurements, 'None.'),
    '',
    '## Suggested Actions',
    formatReportList(recommendation.suggestedActions, 'Review the recommendation before applying printer changes.'),
  ].join('\n');

  return {
    title,
    generatedAt,
    kind: recommendation.kind,
    recommendedValue,
    confidencePct,
    summary: recommendation.summary,
    evidence: recommendation.evidence,
    missingMeasurements,
    suggestedActions: recommendation.suggestedActions,
    measurements,
    frameCount: frames.length,
    markdown,
  };
}

function openAiEndpoint(provider: VisionProviderConfig['provider']): string {
  return provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
}

async function callAnthropicTuning(input: AnalyzeTuningTowerInput): Promise<string> {
  const content: unknown[] = [{ type: 'text', text: buildTuningPrompt(input) }];
  for (const frame of input.frames) {
    const { mimeType, base64 } = splitDataUrl(frame.dataUrl);
    content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.provider.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: input.provider.model,
      max_tokens: 1000,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic tuning API ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return json.content?.find((part) => part.type === 'text')?.text ?? '';
}

async function callOpenAiTuning(input: AnalyzeTuningTowerInput): Promise<string> {
  const response = await fetch(openAiEndpoint(input.provider.provider), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.provider.apiKey}`,
    },
    body: JSON.stringify({
      model: input.provider.model,
      messages: [
        { role: 'system', content: 'You are a careful 3D-printer tuning tower analyzer. Return JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildTuningPrompt(input) },
            ...input.frames.map((frame) => ({ type: 'image_url', image_url: { url: frame.dataUrl } })),
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) throw new Error(`Tuning API ${response.status}: ${await response.text()}`);
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
}

function parseTuningJson(text: string, kind: TuningWizardKind): Omit<TuningTowerRecommendation, 'rawText'> {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`Tuning provider returned invalid JSON: ${trimmed || '<empty response>'}`);
  }
  const jsonText = trimmed.slice(start, end + 1);
  let parsed: Partial<TuningTowerRecommendation>;
  try {
    parsed = JSON.parse(jsonText) as Partial<TuningTowerRecommendation>;
  } catch (error) {
    throw new Error(`Tuning provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    kind: (parsed.kind ?? kind) as TuningWizardKind,
    bestValue: typeof parsed.bestValue === 'number' ? parsed.bestValue : undefined,
    bestHeightMm: typeof parsed.bestHeightMm === 'number' ? parsed.bestHeightMm : undefined,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0))),
    summary: String(parsed.summary ?? 'No tuning recommendation returned.'),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    missingMeasurements: Array.isArray(parsed.missingMeasurements) ? parsed.missingMeasurements.map(String) : undefined,
    settingTweaks: Array.isArray(parsed.settingTweaks) ? parsed.settingTweaks : undefined,
  };
}

export async function analyzeTuningTower(input: AnalyzeTuningTowerInput): Promise<TuningTowerRecommendation> {
  if (!input.provider.apiKey.trim()) {
    throw new Error('Configure an AI provider API key before running tuning analysis.');
  }
  if (input.frames.length === 0) {
    throw new Error('At least one camera frame is required to analyze a tuning tower.');
  }

  const rawText = input.provider.provider === 'anthropic'
    ? await callAnthropicTuning(input)
    : await callOpenAiTuning(input);
  const parsed = parseTuningJson(rawText, input.context.kind);
  const bestValue = parsed.bestValue === undefined && parsed.bestHeightMm !== undefined && input.context.kind === 'pressure-advance'
    ? pressureAdvanceValueFromHeight(parsed.bestHeightMm, input.context.startValue, input.context.stepPerMm)
    : parsed.bestValue;
  return { ...parsed, bestValue, rawText };
}
