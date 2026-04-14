---
name: Parameters System
description: Named variable / parametric design system added to DesignCAD
type: project
---

DesignCAD supports named parameters (like Fusion 360 parameters) that can be used in dimension fields as expressions.

**Why:** User wanted to define reusable variables (e.g., `width = 50`) and reference them in feature dialogs (e.g., `height / 2 + 5`).

**How to apply:** Any feature dialog that accepts a numeric input should use `type="text"` and call `evaluateExpression(expr, parameters)` for live preview and submission.

## Architecture
- **`src/types/cad.ts`** — `Parameter` interface: `{ id, name, expression, value, description?, group? }`
- **`src/utils/expressionEval.ts`** — `evaluateExpression(expr, params): number | null` and `resolveParameters(params): Parameter[]`
  - Supports: `+`, `-`, `*`, `/`, `^` (→ `**`), `sqrt`, `abs`, `sin`, `cos`, `tan`, `floor`, `ceil`, `round`, `PI`/`pi`
  - Safety: rejects expressions with remaining identifiers after substitution
  - Iterative multi-pass for inter-parameter dependencies (handles any declaration order)
- **`src/store/cadStore.ts`** — `parameters[]`, `addParameter()`, `updateParameter()`, `removeParameter()`, `evaluateExpression(expr)`
- **`src/components/ParametersPanel.tsx`** — full dialog UI: table with Name | Expression | Value | Description, inline editing, live preview
- **`src/components/Toolbar.tsx`** — Parameters button in Design tab ribbon, opens via `setActiveDialog('parameters')`
- **`src/components/ExtrudeDialog.tsx`** — uses expression input pattern: `distanceExpr` string state, shows resolved value or error

## Expression input pattern (for new dialogs)
```tsx
const [expr, setExpr] = useState('10');
const resolved = evaluateExpression(expr, parameters);
// ...
<input type="text" value={expr} onChange={e => setExpr(e.target.value)} placeholder="e.g. 10 or width / 2" />
{resolved !== null && expr !== String(resolved) && <div className="expr-resolved">= {resolved} mm</div>}
{resolved === null && <div className="expr-error">Invalid expression</div>}
```
