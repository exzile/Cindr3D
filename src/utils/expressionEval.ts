import type { Parameter } from '../types/cad';

/**
 * Evaluate a math expression, substituting parameter names with their resolved values.
 * Supports: +, -, *, /, ^ (pow), parentheses, and functions: sqrt, abs, sin, cos, tan, floor, ceil, round, PI/pi.
 * Returns null if the expression is invalid or references unknown names.
 */
export function evaluateExpression(expr: string, parameters: Parameter[]): number | null {
  if (!expr || expr.trim() === '') return null;
  try {
    // Build name → value map from already-resolved parameters
    const valMap: Record<string, number> = {};
    for (const p of parameters) {
      if (isFinite(p.value)) valMap[p.name] = p.value;
    }

    // Substitute parameter names (longer names first to avoid partial matches)
    const sortedNames = Object.keys(valMap).sort((a, b) => b.length - a.length);
    let resolved = expr.trim();
    for (const name of sortedNames) {
      resolved = resolved.replace(new RegExp(`\\b${name}\\b`, 'g'), String(valMap[name]));
    }

    // Map ^ to ** and built-in functions to Math.*
    let safe = resolved
      .replace(/\^/g, '**')
      .replace(/\bsqrt\b/g, 'Math.sqrt')
      .replace(/\babs\b/g, 'Math.abs')
      .replace(/\bsin\b/g, 'Math.sin')
      .replace(/\bcos\b/g, 'Math.cos')
      .replace(/\btan\b/g, 'Math.tan')
      .replace(/\bfloor\b/g, 'Math.floor')
      .replace(/\bceil\b/g, 'Math.ceil')
      .replace(/\bround\b/g, 'Math.round')
      .replace(/\bPI\b/g, 'Math.PI')
      .replace(/\bpi\b/g, 'Math.PI');

    // Reject if any bare identifiers remain (unresolved param names or injection attempts)
    const stripped = safe.replace(/Math\.[a-z]+/gi, '');
    if (/[a-zA-Z_$]/.test(stripped)) return null;

    // eslint-disable-next-line no-new-func
    const result = new Function('return (' + safe + ')')();
    if (typeof result === 'number' && isFinite(result)) return result;
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve all parameter values, handling inter-parameter references.
 * Runs multiple passes to handle dependencies (but not cycles).
 */
export function resolveParameters(params: Parameter[]): Parameter[] {
  const resolved: Record<string, number> = {};

  // Iterative passes — each pass may unlock more resolvable parameters
  for (let pass = 0; pass <= params.length; pass++) {
    for (const p of params) {
      if (resolved[p.name] !== undefined) continue;
      const fakeParams: Parameter[] = Object.entries(resolved).map(([name, value]) => ({
        id: name, name, expression: String(value), value, description: undefined,
      }));
      const val = evaluateExpression(p.expression, fakeParams);
      if (val !== null) resolved[p.name] = val;
    }
  }

  return params.map(p => ({
    ...p,
    value: resolved[p.name] ?? NaN,
  }));
}
