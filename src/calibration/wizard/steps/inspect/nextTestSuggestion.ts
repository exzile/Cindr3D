import type { TuningTowerRecommendation } from '../../../../services/vision/tuningWizards';

/**
 * Suggestion for the user to run a different calibration test next, based on
 * AI-recommendation evidence pointing at a problem the current test won't fix.
 */
export interface NextTestSuggestion {
  /** Calibration card `testType` to jump to (e.g. `'first-layer'`, `'retraction'`). */
  testType: string;
  /** Short, user-facing sentence explaining why this test is recommended next. */
  reason: string;
}

interface SuggestNextTestInput {
  recommendation: TuningTowerRecommendation;
  /** Current calibration card `testType` — used to avoid suggesting the same test. */
  currentTestType: string;
}

interface SuggestionRule {
  /** Target calibration testType. */
  testType: string;
  /** Keywords to match against the combined (lowercased) summary + evidence text. */
  keywords: string[];
  /** User-facing reason sentence. */
  reason: string;
  /** Optional gate — only apply when this returns true. Defaults to "always". */
  predicate?: (rec: TuningTowerRecommendation) => boolean;
}

const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Heuristic suggestion table, evaluated top to bottom. First matching rule wins
 * (after filtering out the current test). Keep ordering by specificity — first
 * layer / adhesion issues invalidate later results, so they take priority.
 */
const SUGGESTION_RULES: SuggestionRule[] = [
  {
    testType: 'first-layer',
    keywords: ['first layer', 'adhesion', 'warp'],
    reason: 'First-layer or bed-adhesion issues showed up in the photos — calibrate the first layer next.',
    predicate: (rec) => rec.confidence < LOW_CONFIDENCE_THRESHOLD,
  },
  {
    testType: 'retraction',
    keywords: ['stringing', 'blob', 'ooze'],
    reason: 'Stringing or ooze appeared in the photos — calibrate retraction next.',
  },
  {
    testType: 'input-shaper',
    keywords: ['ringing', 'ghosting', 'echo'],
    reason: 'Ringing or ghosting showed up in the photos — calibrate the input shaper next.',
  },
  {
    testType: 'flow-rate',
    keywords: ['under-extrusion', 'over-extrusion', 'gap', 'wall thickness'],
    reason: 'Extrusion looks off in the photos — calibrate flow rate next.',
  },
  {
    testType: 'temperature-tower',
    keywords: ['bridge', 'overhang', 'delamination'],
    reason: 'Bridging or overhang quality looks off — run a temperature tower next.',
  },
];

/**
 * Build a single lowercased haystack from the recommendation's summary + evidence
 * so each rule's keyword check is a cheap `String.includes`.
 */
function buildHaystack(rec: TuningTowerRecommendation): string {
  const parts: string[] = [];
  if (rec.summary) parts.push(rec.summary);
  for (const ev of rec.evidence) parts.push(ev);
  return parts.join(' ').toLowerCase();
}

/**
 * Inspect an AI calibration recommendation and decide whether to nudge the user
 * toward a different calibration test (e.g. the PA tower evidence mentions
 * stringing — calibrate retraction next).
 *
 * Pure, deterministic, React-free. Returns `null` when nothing actionable is
 * detected or when the only matching rule targets the test we're already on.
 */
export function suggestNextTest({
  recommendation,
  currentTestType,
}: SuggestNextTestInput): NextTestSuggestion | null {
  const haystack = buildHaystack(recommendation);
  if (!haystack) return null;

  for (const rule of SUGGESTION_RULES) {
    if (rule.testType === currentTestType) continue;
    if (rule.predicate && !rule.predicate(recommendation)) continue;
    const hit = rule.keywords.some((kw) => haystack.includes(kw));
    if (hit) {
      return { testType: rule.testType, reason: rule.reason };
    }
  }

  return null;
}
