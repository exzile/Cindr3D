import type { AiProvider } from '../../store/aiAssistantStore';
import type { DuetObjectModel, MachineStatus } from '../../types/duet';
import type { DuetPrefs } from '../../types/duet-prefs.types';
import { cameraByIdFromPrefs, cameraDisplayUrl, prefsWithCamera, previewCameraStreamUrl } from '../../utils/cameraStreamUrl';

export type VisionFailureCategory =
  | 'none'
  | 'spaghetti'
  | 'layer-shift'
  | 'blob-of-doom'
  | 'first-layer-adhesion'
  | 'knocked-loose-part'
  | 'unknown';

export interface VisionFailureSettings {
  sampleIntervalSec: number;
  confidenceThreshold: number;
  autoPauseEnabled: boolean;
  requireUserConfirmation: boolean;
}

export interface VisionFrameSample {
  cameraId: string;
  cameraLabel: string;
  capturedAt: number;
  mimeType: string;
  dataUrl: string;
  size: number;
}

export interface VisionPrinterSnapshot {
  printerId: string;
  printerName: string;
  status?: MachineStatus;
  fileName?: string;
  currentLayer?: number;
  totalLayers?: number;
  layerTimeSec?: number;
  heaters?: Array<{ index: number; current?: number; active?: number; state?: string }>;
  filamentMonitorStatus?: string[];
}

export interface VisionCheckContext {
  printer: VisionPrinterSnapshot;
  geometry?: unknown;
  recentNotes?: string[];
}

export interface VisionProviderConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

export interface VisionCheckInput {
  frame: VisionFrameSample;
  context: VisionCheckContext;
  provider: VisionProviderConfig;
  settings: VisionFailureSettings;
}

export interface VisionCheckResult {
  category: VisionFailureCategory;
  confidence: number;
  severity: 'none' | 'watch' | 'warning' | 'critical';
  summary: string;
  evidence: string[];
  suggestedActions: string[];
  shouldPause: boolean;
  requiresConfirmation: boolean;
  rawText?: string;
}

export interface VisionFrameSamplerOptions {
  intervalSec: number;
  capture: () => Promise<VisionFrameSample>;
  onFrame: (frame: VisionFrameSample) => void | Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => number;
}

export const DEFAULT_VISION_FAILURE_SETTINGS: VisionFailureSettings = {
  sampleIntervalSec: 60,
  confidenceThreshold: 0.82,
  autoPauseEnabled: false,
  requireUserConfirmation: true,
};

export function shouldSampleVisionFrame(lastSampleAt: number | null | undefined, now: number, intervalSec: number): boolean {
  if (!lastSampleAt) return true;
  return now - lastSampleAt >= Math.max(1, intervalSec) * 1000;
}

export class VisionFrameSampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSampleAt: number | null = null;
  private sampling = false;
  private readonly options: VisionFrameSamplerOptions;

  constructor(options: VisionFrameSamplerOptions) {
    this.options = options;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    void this.sampleNow();
    this.timer = setInterval(() => {
      void this.sampleNow();
    }, Math.max(1, this.options.intervalSec) * 1000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async sampleNow(): Promise<VisionFrameSample | null> {
    const now = this.options.now?.() ?? Date.now();
    if (this.sampling || !shouldSampleVisionFrame(this.lastSampleAt, now, this.options.intervalSec)) return null;
    this.sampling = true;
    try {
      const frame = await this.options.capture();
      this.lastSampleAt = now;
      await this.options.onFrame(frame);
      return frame;
    } catch (error) {
      this.options.onError?.(error);
      return null;
    } finally {
      this.sampling = false;
    }
  }
}

export function summarizePrinterModel(
  printerId: string,
  printerName: string,
  model: Partial<DuetObjectModel>,
): VisionPrinterSnapshot {
  const heaters = model.heat?.heaters?.map((heater, index) => ({
    index,
    current: heater.current,
    active: heater.active,
    state: heater.state,
  }));
  const filamentMonitorStatus = model.sensors?.filamentMonitors
    ?.map((monitor, index) => `monitor ${index}: ${monitor.status ?? (monitor.filamentPresent === false ? 'noFilament' : 'unknown')}`);

  return {
    printerId,
    printerName,
    status: model.state?.status,
    fileName: model.job?.file?.fileName ?? model.job?.lastFileName,
    currentLayer: model.job?.layer,
    totalLayers: model.job?.file?.numLayers,
    layerTimeSec: model.job?.layerTime,
    heaters,
    filamentMonitorStatus,
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read camera frame.'));
    reader.readAsDataURL(blob);
  });
}

export async function captureVisionFrame(
  prefs: DuetPrefs,
  options: { cameraId?: string; fallbackUrl?: string } = {},
): Promise<VisionFrameSample> {
  const camera = cameraByIdFromPrefs(prefs, options.cameraId);
  if (camera.sourceType === 'browser-usb') {
    throw new Error('Browser USB camera snapshots are not available to the vision service yet.');
  }

  const cameraPrefs = prefsWithCamera(prefs, camera.id);
  const streamUrl = previewCameraStreamUrl(cameraPrefs, options.fallbackUrl ?? '');
  if (!streamUrl) throw new Error(`Camera ${camera.label} does not have a browser-readable snapshot URL.`);

  const displayUrl = cameraDisplayUrl(streamUrl, cameraPrefs.webcamUsername, cameraPrefs.webcamPassword);
  const response = await fetch(displayUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Camera ${camera.label} returned HTTP ${response.status}.`);

  const blob = await response.blob();
  return {
    cameraId: camera.id,
    cameraLabel: camera.label,
    capturedAt: Date.now(),
    mimeType: blob.type || 'image/jpeg',
    dataUrl: await blobToDataUrl(blob),
    size: blob.size,
  };
}

function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(dataUrl);
  if (!match) throw new Error('Vision frame must be a base64 data URL.');
  return { mimeType: match[1], base64: match[2] };
}

function visionPrompt(input: VisionCheckInput): string {
  return [
    'You are Cindr3D vision failure detection. Classify the current 3D print from the camera frame and telemetry.',
    'Return only compact JSON with keys: category, confidence, severity, summary, evidence, suggestedActions.',
    'category must be one of: none, spaghetti, layer-shift, blob-of-doom, first-layer-adhesion, knocked-loose-part, unknown.',
    'confidence is 0..1. severity is one of: none, watch, warning, critical.',
    `Printer context: ${JSON.stringify(input.context)}`,
  ].join('\n');
}

async function callAnthropicVision(input: VisionCheckInput): Promise<string> {
  const { mimeType, base64 } = splitDataUrl(input.frame.dataUrl);
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
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: visionPrompt(input) },
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic vision API ${response.status}: ${await response.text()}`);
  const json = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return json.content?.find((part) => part.type === 'text')?.text ?? '';
}

function openAiEndpoint(provider: AiProvider): string {
  return provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
}

async function callOpenAiVision(input: VisionCheckInput): Promise<string> {
  const response = await fetch(openAiEndpoint(input.provider.provider), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.provider.apiKey}`,
    },
    body: JSON.stringify({
      model: input.provider.model,
      messages: [
        { role: 'system', content: 'You are a careful 3D-print failure classifier. Return JSON only.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: visionPrompt(input) },
            { type: 'image_url', image_url: { url: input.frame.dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) throw new Error(`Vision API ${response.status}: ${await response.text()}`);
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
}

function parseVisionJson(text: string): Omit<VisionCheckResult, 'shouldPause' | 'requiresConfirmation' | 'rawText'> {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`Vision provider returned invalid JSON: ${trimmed || '<empty response>'}`);
  }
  const jsonText = trimmed.slice(start, end + 1);
  let parsed: Partial<VisionCheckResult>;
  try {
    parsed = JSON.parse(jsonText) as Partial<VisionCheckResult>;
  } catch (error) {
    throw new Error(`Vision provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const category = (parsed.category ?? 'unknown') as VisionFailureCategory;
  const severity = parsed.severity ?? (category === 'none' ? 'none' : 'warning');
  return {
    category,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0))),
    severity,
    summary: String(parsed.summary ?? 'No summary returned.'),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
  };
}

export async function classifyPrintFrame(input: VisionCheckInput): Promise<VisionCheckResult> {
  if (!input.provider.apiKey.trim()) {
    throw new Error('Configure an AI provider API key before running vision failure detection.');
  }

  const rawText = input.provider.provider === 'anthropic'
    ? await callAnthropicVision(input)
    : await callOpenAiVision(input);
  const parsed = parseVisionJson(rawText);
  const meetsThreshold = parsed.category !== 'none' && parsed.confidence >= input.settings.confidenceThreshold;
  const shouldPause = input.settings.autoPauseEnabled && meetsThreshold;
  return {
    ...parsed,
    shouldPause,
    requiresConfirmation: shouldPause && input.settings.requireUserConfirmation,
    rawText,
  };
}
