/**
 * Sketch-text font registry.
 *
 * Maps a (family, bold, italic) request to the best available .ttf face shipped
 * in /public/fonts. When a family lacks a dedicated bold+italic face, we load
 * the nearest face and let the geometry generator synthesize the missing italic
 * via shear (`shear: true`). Regular-only fallbacks degrade gracefully.
 */

export type FontFamilyKey = 'default' | 'serif' | 'monospace';

interface FamilyFaces {
  label: string;
  regular: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

const FONT_DIR = '/fonts';

const FAMILIES: Record<FontFamilyKey, FamilyFaces> = {
  default: {
    label: 'Roboto',
    regular: `${FONT_DIR}/Roboto-Regular.ttf`,
    bold: `${FONT_DIR}/Roboto-Bold.ttf`,
    italic: `${FONT_DIR}/Roboto-Italic.ttf`,
    boldItalic: `${FONT_DIR}/Roboto-BoldItalic.ttf`,
  },
  serif: {
    label: 'Roboto Serif',
    regular: `${FONT_DIR}/RobotoSerif-Regular.ttf`,
    bold: `${FONT_DIR}/RobotoSerif-Bold.ttf`,
    italic: `${FONT_DIR}/RobotoSerif-Italic.ttf`,
    // no dedicated bold-italic — resolver falls back to bold + shear
  },
  monospace: {
    label: 'Roboto Mono',
    regular: `${FONT_DIR}/RobotoMono-Regular.ttf`,
    bold: `${FONT_DIR}/RobotoMono-Bold.ttf`,
    italic: `${FONT_DIR}/RobotoMono-Italic.ttf`,
  },
};

/** Dropdown options for the Text panel — keys map 1:1 to FAMILIES. */
export const FONT_FAMILY_OPTIONS: Array<{ value: FontFamilyKey; label: string }> =
  (Object.keys(FAMILIES) as FontFamilyKey[]).map((value) => ({ value, label: FAMILIES[value].label }));

export interface ResolvedFace {
  /** URL of the .ttf to load. */
  url: string;
  /** True when the loaded face is not a real italic and the renderer must shear. */
  shear: boolean;
}

/**
 * Pick the best face for the request. Synthesizes italic (shear) only when the
 * chosen face is upright but italic was requested.
 */
export function resolveFace(family: string, bold: boolean, italic: boolean): ResolvedFace {
  const fam = FAMILIES[(family as FontFamilyKey)] ?? FAMILIES.default;

  if (bold && italic) {
    if (fam.boldItalic) return { url: fam.boldItalic, shear: false };
    if (fam.bold) return { url: fam.bold, shear: true };      // bold face + faux italic
    if (fam.italic) return { url: fam.italic, shear: false };
    return { url: fam.regular, shear: true };
  }
  if (bold) {
    return { url: fam.bold ?? fam.regular, shear: false };
  }
  if (italic) {
    if (fam.italic) return { url: fam.italic, shear: false };
    return { url: fam.regular, shear: true };                 // faux italic
  }
  return { url: fam.regular, shear: false };
}
