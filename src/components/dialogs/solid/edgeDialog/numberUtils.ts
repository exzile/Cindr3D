import type { FocusEvent, MouseEvent } from "react";

export function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export function selectNumberText(
  e: FocusEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>,
) {
  e.currentTarget.select();
}
