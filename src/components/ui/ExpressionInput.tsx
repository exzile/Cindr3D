import "./ExpressionInput.css";
/**
 * ExpressionInput (D63) — a numeric input that also accepts Fusion-style
 * expressions like "width/2 + 3". Falls back to the raw number on invalid
 * expressions. Shows a subtle tint when an expression is active.
 */
import { useState, useRef, useEffect } from 'react';
import { useCADStore } from '../../store/cadStore';
import { evaluateExpression } from '../../utils/expressionEval';

interface ExpressionInputProps {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function ExpressionInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  className,
  style,
}: ExpressionInputProps) {
  const parameters = useCADStore((s) => s.parameters);
  const [text, setText] = useState(String(value));
  const [isExpr, setIsExpr] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from external value changes (e.g. gizmo drag) — but only when not editing
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(String(value));
      setIsExpr(false);
      setIsInvalid(false);
    }
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    // Pure number?
    const asNum = parseFloat(trimmed);
    if (!isNaN(asNum) && String(asNum) === trimmed) {
      const clamped = min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, asNum) : asNum)
        : max !== undefined ? Math.min(max, asNum) : asNum;
      setText(String(clamped));
      setIsExpr(false);
      setIsInvalid(false);
      if (clamped !== value) onChange(clamped);
      return;
    }
    // Try expression evaluation
    const result = evaluateExpression(trimmed, parameters);
    if (result !== null && isFinite(result)) {
      const clamped = min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, result) : result)
        : max !== undefined ? Math.min(max, result) : result;
      setIsExpr(true);
      setIsInvalid(false);
      setText(trimmed); // keep expression text visible while focused
      if (clamped !== value) onChange(clamped);
    } else {
      setIsInvalid(true);
    }
  };

  const handleTextChange = (nextText: string) => {
    setText(nextText);

    const trimmed = nextText.trim();
    if (trimmed === '') return;

    const asNum = Number(trimmed);
    if (!Number.isFinite(asNum)) return;

    const clamped = min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, asNum) : asNum)
      : max !== undefined ? Math.min(max, asNum) : asNum;
    setIsExpr(false);
    setIsInvalid(false);
    if (clamped !== value) onChange(clamped);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={text}
      step={step}
      min={min}
      max={max}
      className={className}
      style={{
        ...style,
        background: isInvalid ? 'rgba(239,68,68,0.15)' : isExpr ? 'rgba(99,102,241,0.12)' : undefined,
        outline: isInvalid ? '1px solid #ef4444' : undefined,
      }}
      onChange={(e) => handleTextChange(e.target.value)}
      onBlur={(e) => {
        commit(e.target.value);
        // After blur, show the resolved numeric value
        if (!isInvalid) setText(String(value));
        setIsExpr(false);
      }}
      onFocus={() => {
        // If the field has an expression, show it again when refocused
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit((e.target as HTMLInputElement).value);
          inputRef.current?.blur();
        } else if (e.key === 'Escape') {
          setText(String(value));
          setIsExpr(false);
          setIsInvalid(false);
          inputRef.current?.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // Nudge numeric value by step
          const delta = (e.key === 'ArrowUp' ? 1 : -1) * (step ?? 1) * (e.shiftKey ? 10 : 1);
          const next = value + delta;
          const clamped = min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, next) : next)
            : max !== undefined ? Math.min(max, next) : next;
          const rounded = Math.round(clamped * 1000) / 1000;
          setText(String(rounded));
          onChange(rounded);
          e.preventDefault();
        }
      }}
    />
  );
}
