import type { CSSProperties } from 'react';
import { colors as COLORS } from './theme';

export function panelStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: COLORS.panel,
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: 8,
    padding: 16,
    ...extra,
  };
}

export function compactIconOnlyButtonStyle(extra?: CSSProperties): CSSProperties {
  return compactActionButtonStyle({
    padding: 3,
    fontSize: 10,
    gap: 0,
    ...extra,
  });
}

export function dashboardButtonStyle(
  variant: 'default' | 'accent' | 'danger' | 'success' = 'default',
  small = false,
): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: small ? 11 : 12,
    fontWeight: 500,
    transition: 'background 0.15s, opacity 0.15s',
    padding: small ? '3px 6px' : '6px 12px',
    color: '#fff',
  };
  if (variant === 'accent') return { ...base, background: COLORS.accent };
  if (variant === 'danger') return { ...base, background: COLORS.danger };
  if (variant === 'success') return { ...base, background: COLORS.success };
  return { ...base, background: COLORS.surface, color: COLORS.text };
}

export function compactPanelInputStyle(width = 60): CSSProperties {
  return {
    background: COLORS.inputBg,
    border: `1px solid ${COLORS.inputBorder}`,
    borderRadius: 4,
    color: COLORS.text,
    padding: '4px 6px',
    fontSize: 12,
    width,
    fontFamily: 'inherit',
    outline: 'none',
  };
}

export function primaryActionButtonStyle(enabled: boolean, extra?: CSSProperties): CSSProperties {
  return compactActionButtonStyle({
    background: enabled ? COLORS.accent : COLORS.surface,
    color: enabled ? '#fff' : COLORS.textDim,
    borderColor: enabled ? COLORS.accent : COLORS.panelBorder,
    cursor: enabled ? 'pointer' : 'not-allowed',
    ...extra,
  });
}

export function sectionTitleStyle(extra?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 10,
    fontWeight: 600,
    ...extra,
  };
}

export function twoColRowGridStyle(extra?: CSSProperties): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '6px 12px',
    fontSize: 12,
    ...extra,
  };
}

export function dimTextStyle(extra?: CSSProperties): CSSProperties {
  return {
    color: COLORS.textDim,
    ...extra,
  };
}

export function monoTextStyle(extra?: CSSProperties): CSSProperties {
  return {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 600,
    ...extra,
  };
}

export function compactActionButtonStyle(extra?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${COLORS.panelBorder}`,
    background: COLORS.surface,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 11,
    ...extra,
  };
}

export function panelInputStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: COLORS.inputBg,
    border: `1px solid ${COLORS.inputBorder}`,
    borderRadius: 4,
    color: COLORS.text,
    padding: '6px 8px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    ...extra,
  };
}
