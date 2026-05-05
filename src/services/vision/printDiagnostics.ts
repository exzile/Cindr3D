import type { VisionFrameSample, VisionPrinterSnapshot, VisionProviderConfig } from './failureDetector';

export interface PrintDiagnosticsTelemetry {
  printer: VisionPrinterSnapshot;
  motorCurrents?: unknown;
  filamentSensorState?: string[];
  expectedLayerTimeSec?: number;
  actualLayerTimeSec?: number;
  slicerLayerDeltaSec?: number;
  geometry?: unknown;
  recentFailureChecks?: Array<{
    category: string;
    confidence: number;
    severity: string;
    summary: string;
    createdAt: number;
  }>;
  operatorNotes?: string[];
}

export interface DiagnosePrintInput {
  frames: VisionFrameSample[];
  telemetry: PrintDiagnosticsTelemetry;
  provider: VisionProviderConfig;
}

export interface PrintDiagnosisSuggestion {
  title: string;
  rationale: string;
  confidence: number;
  settingTweaks?: Array<{ tool: string; args: Record<string, unknown>; label: string }>;
}

export interface PrintDiagnosisResult {
  summary: string;
  rankedCauses: PrintDiagnosisSuggestion[];
  immediateActions: string[];
  needsHumanReview: boolean;
  rawText?: string;
}

function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl);
  if (!match) throw new Error('Diagnostic frame must be a base64 data URL.');
  return { mimeType: match[1], base64: match[2] };
}

export function buildDiagnosticsPrompt(input: DiagnosePrintInput): string {
  return [
    'You are Cindr3D print diagnostics. Diagnose what is wrong with the current 3D print using camera frames and telemetry.',
    'Return only compact JSON with keys: summary, rankedCauses, immediateActions, needsHumanReview.',
    'rankedCauses is an array of objects with title, rationale, confidence, and optional settingTweaks.',
    'settingTweaks must use available tool names such as slicer_set_setting, slicer_set_material_setting, printer_set_speed_factor, printer_set_flow_factor, printer_set_fan_speed, or printer_set_baby_step.',
    'Prefer reversible operator advice unless the telemetry strongly supports a setting change.',
    `Telemetry: ${JSON.stringify(input.telemetry)}`,
  ].join('\n');
}

function openAiEndpoint(provider: VisionProviderConfig['provider']): string {
  return provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
}

async function callAnthropicDiagnostics(input: DiagnosePrintInput): Promise<string> {
  const content: unknown[] = [{ type: 'text', text: buildDiagnosticsPrompt(input) }];
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
      max_tokens: 1200,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic diagnostics API ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return json.content?.find((part) => part.type === 'text')?.text ?? '';
}

async function callOpenAiDiagnostics(input: DiagnosePrintInput): Promise<string> {
  const response = await fetch(openAiEndpoint(input.provider.provider), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.provider.apiKey}`,
    },
    body: JSON.stringify({
      model: input.provider.model,
      messages: [
        { role: 'system', content: 'You are a careful 3D-print diagnostics assistant. Return JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildDiagnosticsPrompt(input) },
            ...input.frames.map((frame) => ({ type: 'image_url', image_url: { url: frame.dataUrl } })),
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) throw new Error(`Diagnostics API ${response.status}: ${await response.text()}`);
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
}

function parseDiagnosisJson(text: string): Omit<PrintDiagnosisResult, 'rawText'> {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`Diagnostics provider returned invalid JSON: ${trimmed || '<empty response>'}`);
  }
  const jsonText = trimmed.slice(start, end + 1);
  let parsed: Partial<PrintDiagnosisResult>;
  try {
    parsed = JSON.parse(jsonText) as Partial<PrintDiagnosisResult>;
  } catch (error) {
    throw new Error(`Diagnostics provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rankedCauses = Array.isArray(parsed.rankedCauses)
    ? parsed.rankedCauses.map((cause) => {
      const c = cause as Partial<PrintDiagnosisSuggestion>;
      return {
        title: String(c.title ?? 'Unknown cause'),
        rationale: String(c.rationale ?? ''),
        confidence: Math.min(1, Math.max(0, Number(c.confidence ?? 0))),
        settingTweaks: Array.isArray(c.settingTweaks) ? c.settingTweaks : undefined,
      };
    })
    : [];
  return {
    summary: String(parsed.summary ?? 'No diagnosis summary returned.'),
    rankedCauses,
    immediateActions: Array.isArray(parsed.immediateActions) ? parsed.immediateActions.map(String) : [],
    needsHumanReview: parsed.needsHumanReview !== false,
  };
}

export async function diagnosePrint(input: DiagnosePrintInput): Promise<PrintDiagnosisResult> {
  if (!input.provider.apiKey.trim()) {
    throw new Error('Configure an AI provider API key before running print diagnostics.');
  }
  if (input.frames.length === 0) {
    throw new Error('At least one camera frame is required to diagnose a print.');
  }

  const rawText = input.provider.provider === 'anthropic'
    ? await callAnthropicDiagnostics(input)
    : await callOpenAiDiagnostics(input);
  return { ...parseDiagnosisJson(rawText), rawText };
}
