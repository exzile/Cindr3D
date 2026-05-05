import type { VisionFrameSample, VisionPrinterSnapshot, VisionProviderConfig } from './failureDetector';

export type TuningWizardKind =
  | 'pressure-advance'
  | 'retraction'
  | 'temperature'
  | 'first-layer-squish'
  | 'input-shaper';

export interface TuningTowerContext {
  kind: TuningWizardKind;
  printer: VisionPrinterSnapshot;
  startValue?: number;
  stepPerMm?: number;
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
  settingTweaks?: Array<{ tool: string; args: Record<string, unknown>; label: string }>;
  rawText?: string;
}

function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl);
  if (!match) throw new Error('Tuning frame must be a base64 data URL.');
  return { mimeType: match[1], base64: match[2] };
}

export function pressureAdvanceValueFromHeight(heightMm: number, startValue = 0, stepPerMm = 0.005): number {
  return Number((startValue + heightMm * stepPerMm).toFixed(4));
}

export function buildTuningPrompt(input: AnalyzeTuningTowerInput): string {
  return [
    'You are Cindr3D auto-tune vision analysis. Analyze calibration tower camera frames and recommend only the measured setting.',
    'The printer remains under operator control; do not claim to start, stop, or modify the printer.',
    'Return only compact JSON with keys: kind, bestValue, bestHeightMm, confidence, summary, evidence, suggestedActions, settingTweaks.',
    'For pressure-advance, bestValue = startValue + bestHeightMm * stepPerMm when a best height is visible.',
    'For first-layer-squish, bestValue is suggested Z-offset delta in millimeters.',
    'settingTweaks may include safe app tools such as slicer_set_material_setting, slicer_set_setting, printer_set_baby_step, printer_set_speed_factor, printer_set_flow_factor, or printer_set_fan_speed.',
    `Context: ${JSON.stringify(input.context)}`,
  ].join('\n');
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
