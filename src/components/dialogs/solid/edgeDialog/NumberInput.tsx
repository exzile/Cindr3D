import type { CSSProperties } from "react";
import { clamp, selectNumberText } from "./numberUtils";

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  fallback: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
  labelStyle?: CSSProperties;
  inputStyle?: CSSProperties;
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  fallback,
  title,
  className = "form-group",
  style,
  labelStyle,
  inputStyle,
}: NumberInputProps) {
  return (
    <div className={className} style={style}>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        style={inputStyle}
        value={value}
        onFocus={selectNumberText}
        onClick={selectNumberText}
        onChange={(e) =>
          onChange(clamp(parseFloat(e.target.value) || fallback, min, max))
        }
        min={min}
        max={max}
        step={step}
        title={title}
      />
    </div>
  );
}
