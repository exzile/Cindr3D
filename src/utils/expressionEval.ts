import { all, create, type MathNode } from 'mathjs';
import type { Parameter } from '../types/cad';

// Hardened mathjs instance: untrusted user expressions can otherwise reach
// `cos.constructor("...")` for arbitrary code execution, or use `import` /
// `createUnit` to mutate the shared math namespace. Capture parse() before
// disabling it so we can still invoke it from JS, then disable the dangerous
// surface and reject AST nodes that grant access to host objects.
const safeMath = create(all, {});
const safeParse = safeMath.parse.bind(safeMath);
const disabled = (name: string) => () => {
  throw new Error(`Function "${name}" is disabled in expression evaluation`);
};
safeMath.import(
  {
    import: disabled('import'),
    createUnit: disabled('createUnit'),
    evaluate: disabled('evaluate'),
    parse: disabled('parse'),
    simplify: disabled('simplify'),
    derivative: disabled('derivative'),
    resolve: disabled('resolve'),
  },
  { override: true },
);

function isExpressionSafe(node: MathNode): boolean {
  // FunctionAssignmentNode lets users define new functions (closures over scope);
  // AccessorNode / IndexNode reach properties like `.constructor` → host RCE.
  let safe = true;
  node.traverse((n: MathNode) => {
    const t = n.type;
    if (t === 'FunctionAssignmentNode' || t === 'AccessorNode' || t === 'IndexNode') {
      safe = false;
    }
  });
  return safe;
}

export function evaluateExpression(expr: string, parameters: Parameter[]): number | null {
  if (!expr || expr.trim() === '') return null;
  try {
    const node = safeParse(expr.trim());
    if (!isExpressionSafe(node)) return null;
    const scope: Record<string, number> = { PI: Math.PI };
    for (const p of parameters) {
      if (isFinite(p.value)) scope[p.name] = p.value;
    }
    const result = node.compile().evaluate(scope);
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
