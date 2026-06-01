export interface TextSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextFormatOptions {
  italic?: boolean;
  bold?: boolean;
  /**
   * Apply synthetic italic shear. Set by the font resolver when the loaded face
   * is upright but italic was requested (no true italic face available). When a
   * real italic face is loaded this stays false so glyphs aren't double-slanted.
   */
  shear?: boolean;
  charSpacing?: number;
  flipH?: boolean;
  flipV?: boolean;
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
}
