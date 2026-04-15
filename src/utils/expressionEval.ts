import { evaluate } from 'mathjs';
import type { Parameter } from '../types/cad';

export function evaluateExpression(expr: string, parameters: Parameter[]): number | null {
  if (!expr || expr.trim() === '') return null;
  try {
    const scope: Record<string, number> = { PI: Math.PI };
    for (const p of parameters) {
      if (isFinite(p.value)) scope[p.name] = p.value;
    }
    const result = evaluate(expr.trim(), scope);
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
