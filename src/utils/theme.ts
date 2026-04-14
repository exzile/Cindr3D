import type React from 'react';

// =============================================================================
// Shared color tokens — reference CSS custom properties set by themeStore.
//
// Usage in inline styles:
//   <div style={{ background: colors.panel, color: colors.text }}>
//
// The browser resolves var() references dynamically, so theme changes from
// themeStore.applyTheme() automatically propagate to every component that
// uses these tokens — no re-render required.
// =============================================================================

export const colors = {
  // ── Backgrounds ────────────────────────────────────────────────────────────
  bg:              'var(--bg-primary)',
  panel:           'var(--bg-panel)',
  panelLight:      'var(--bg-toolbar)',      // slightly lighter panel
  elevated:        'var(--bg-elevated)',     // raised cards / inner surfaces
  elevatedHover:   'var(--bg-elevated-hover)',
  inputBg:         'var(--bg-input)',
  hover:           'var(--bg-hover)',
  active:          'var(--bg-active)',
  // ── Text ───────────────────────────────────────────────────────────────────
  text:            'var(--text-primary)',
  textSecondary:   'var(--text-secondary)',
  textDim:         'var(--text-muted)',
  // ── Borders ────────────────────────────────────────────────────────────────
  panelBorder:     'var(--border)',
  borderLight:     'var(--border-light)',
  borderStrong:    'var(--border-strong)',
  inputBorder:     'var(--border)',
  // ── Accent ─────────────────────────────────────────────────────────────────
  accent:          'var(--accent)',
  accentHover:     'var(--accent-hover)',
  accentLight:     'var(--accent-light)',
  accentDim:       'var(--accent-dim)',
  // ── Status ─────────────────────────────────────────────────────────────────
  success:         'var(--success)',
  warning:         'var(--warning)',
  danger:          'var(--error)',
  dangerHover:     'var(--error)',
  error:           'var(--error)',
  info:            'var(--info)',
  // ── Overlay ────────────────────────────────────────────────────────────────
  overlay:         'var(--overlay-bg)',
  // ── Aliases used in Duet components ────────────────────────────────────────
  surface:         'var(--bg-elevated)',
  surfaceHover:    'var(--bg-elevated-hover)',
} as const;

// ── Shared inline-style helpers used across SlicerWorkspace + Duet pages ─────

export const sharedStyles = {
  panel: {
    background: colors.panel,
    border: `1px solid ${colors.panelBorder}`,
    borderRadius: 8,
    padding: 16,
  } as React.CSSProperties,

  input: {
    background: colors.inputBg,
    color: colors.text,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
  } as React.CSSProperties,

  select: {
    background: colors.inputBg,
    color: colors.text,
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
    cursor: 'pointer',
  } as React.CSSProperties,

  label: {
    fontSize: 11,
    fontWeight: 600 as const,
    color: colors.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 4,
  } as React.CSSProperties,

  btnBase: {
    background: colors.panelLight,
    color: colors.text,
    border: `1px solid ${colors.panelBorder}`,
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } as React.CSSProperties,

  btnAccent: {
    background: colors.accent,
    color: '#fff',
    border: `1px solid ${colors.accent}`,
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } as React.CSSProperties,

  btnDanger: {
    background: 'transparent',
    color: colors.danger,
    border: `1px solid ${colors.danger}`,
    borderRadius: 4,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } as React.CSSProperties,
};
