// DimensionEngine.ts — Pure-math module for dimension annotation geometry.
// No THREE.js dependency. All coordinates are 2D sketch space (model units = mm).

// ---------------------------------------------------------------------------
// Annotation Types
// ---------------------------------------------------------------------------

export interface LinearDimension {
  type: 'linear';
  value: number;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  extensionLine1: [{ x: number; y: number }, { x: number; y: number }];
  extensionLine2: [{ x: number; y: number }, { x: number; y: number }];
  dimensionLine: [{ x: number; y: number }, { x: number; y: number }];
  textPosition: { x: number; y: number };
  textAngle: number;
}

export interface AlignedDimension {
  type: 'aligned';
  value: number;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  extensionLine1: [{ x: number; y: number }, { x: number; y: number }];
  extensionLine2: [{ x: number; y: number }, { x: number; y: number }];
  dimensionLine: [{ x: number; y: number }, { x: number; y: number }];
  textPosition: { x: number; y: number };
  textAngle: number;
}

export interface ArcLengthDimension {
  type: 'arc-length';
  value: number;
  arcCenter: { x: number; y: number };
  arcRadius: number;
  startAngle: number;
  endAngle: number;
  annotationArc: { cx: number; cy: number; r: number; startAngle: number; endAngle: number };
  textPosition: { x: number; y: number };
}

export interface AngleDimension {
  type: 'angle';
  value: number;
  vertex: { x: number; y: number };
  ray1End: { x: number; y: number };
  ray2End: { x: number; y: number };
  annotationArc: { cx: number; cy: number; r: number; startAngle: number; endAngle: number };
  textPosition: { x: number; y: number };
}

export interface DiameterDimension {
  type: 'diameter';
  value: number;
  center: { x: number; y: number };
  radius: number;
  dimensionLine: [{ x: number; y: number }, { x: number; y: number }];
  textPosition: { x: number; y: number };
}

export type DimensionAnnotation =
  | LinearDimension
  | AlignedDimension
  | ArcLengthDimension
  | AngleDimension
  | DiameterDimension;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Vec2 = { x: number; y: number };

function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
function scale(v: Vec2, s: number): Vec2 { return { x: v.x * s, y: v.y * s }; }
function midpoint(a: Vec2, b: Vec2): Vec2 { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

// ---------------------------------------------------------------------------
// DimensionEngine
// ---------------------------------------------------------------------------

export class DimensionEngine {
  /**
   * Computes a horizontal or vertical linear dimension between two points.
   *
   * @param p1     First measurement point (2D sketch space)
   * @param p2     Second measurement point (2D sketch space)
   * @param offset Distance the dimension line is offset perpendicular to the
   *               measurement direction (positive = away from origin)
   * @param axis   'horizontal' measures ΔX, 'vertical' measures ΔY,
   *               'auto' picks the axis with the larger delta
   */
  static computeLinearDimension(
    p1: Vec2,
    p2: Vec2,
    offset: number,
    axis: 'horizontal' | 'vertical' | 'auto' = 'auto',
  ): LinearDimension {
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);

    // Resolve 'auto' to whichever axis has the larger delta
    const resolvedAxis: 'horizontal' | 'vertical' =
      axis === 'auto' ? (dx >= dy ? 'horizontal' : 'vertical') : axis;

    if (resolvedAxis === 'horizontal') {
      // Measure ΔX; dimension line is horizontal, offset vertically
      const value = dx;

      // Anchor the measurement to the min/max X for clean rendering
      const xLeft  = Math.min(p1.x, p2.x);
      const xRight = Math.max(p1.x, p2.x);

      // The offset sign is determined by which side has less geometry; use
      // positive (above) when offset > 0, negative (below) when offset < 0.
      const yBase = (p1.y + p2.y) / 2; // nominal baseline
      const yDim  = yBase + offset;

      const dimP1: Vec2 = { x: xLeft,  y: yDim };
      const dimP2: Vec2 = { x: xRight, y: yDim };

      // Extension lines: from original points up/down to the dimension line
      const ext1Start: Vec2 = { x: xLeft,  y: p1.y < p2.y ? p1.y : p2.y };
      const ext1End:   Vec2 = { x: xLeft,  y: yDim };
      const ext2Start: Vec2 = { x: xRight, y: p1.y < p2.y ? p1.y : p2.y };
      const ext2End:   Vec2 = { x: xRight, y: yDim };

      // Correct ext1/2 start to the actual point y values
      const p1IsLeft = p1.x <= p2.x;
      const leftY  = p1IsLeft ? p1.y : p2.y;
      const rightY = p1IsLeft ? p2.y : p1.y;

      return {
        type: 'linear',
        value,
        p1,
        p2,
        extensionLine1: [{ x: xLeft,  y: leftY  }, { x: xLeft,  y: yDim }],
        extensionLine2: [{ x: xRight, y: rightY }, { x: xRight, y: yDim }],
        dimensionLine:  [dimP1, dimP2],
        textPosition:   midpoint(dimP1, dimP2),
        textAngle:      0, // horizontal text
      };
    } else {
      // Measure ΔY; dimension line is vertical, offset horizontally
      const value = dy;

      const yBottom = Math.min(p1.y, p2.y);
      const yTop    = Math.max(p1.y, p2.y);
      const xBase   = (p1.x + p2.x) / 2;
      const xDim    = xBase + offset;

      const dimP1: Vec2 = { x: xDim, y: yBottom };
      const dimP2: Vec2 = { x: xDim, y: yTop    };

      const p1IsBottom = p1.y <= p2.y;
      const bottomX = p1IsBottom ? p1.x : p2.x;
      const topX    = p1IsBottom ? p2.x : p1.x;

      return {
        type: 'linear',
        value,
        p1,
        p2,
        extensionLine1: [{ x: bottomX, y: yBottom }, { x: xDim, y: yBottom }],
        extensionLine2: [{ x: topX,    y: yTop    }, { x: xDim, y: yTop    }],
        dimensionLine:  [dimP1, dimP2],
        textPosition:   midpoint(dimP1, dimP2),
        textAngle:      90, // vertical text
      };
    }
  }

  /**
   * Computes an aligned (true-length) dimension along the line p1→p2.
   * The dimension line is parallel to p1→p2, offset perpendicular by `offset`.
   *
   * @param p1     First measurement point
   * @param p2     Second measurement point
   * @param offset Perpendicular offset distance (positive = CCW / left of p1→p2)
   */
  static computeAlignedDimension(
    p1: Vec2,
    p2: Vec2,
    offset: number,
  ): AlignedDimension {
    const value = dist(p1, p2);

    const raw = { x: p2.x - p1.x, y: p2.y - p1.y };
    const d = normalize(raw);                        // unit direction p1→p2
    const n = { x: -d.y, y: d.x };                  // 90° CCW perpendicular

    const offVec = scale(n, offset);

    const dimP1 = add(p1, offVec);
    const dimP2 = add(p2, offVec);

    const textAngle = (Math.atan2(d.y, d.x) * 180) / Math.PI;

    return {
      type: 'aligned',
      value,
      p1,
      p2,
      extensionLine1: [p1, dimP1],
      extensionLine2: [p2, dimP2],
      dimensionLine:  [dimP1, dimP2],
      textPosition:   midpoint(dimP1, dimP2),
      textAngle,
    };
  }

  /**
   * Computes arc-length dimension for a circular arc entity.
   *
   * @param cx         Arc center X
   * @param cy         Arc center Y
   * @param r          Arc radius
   * @param startAngle Arc start in radians (CCW positive)
   * @param endAngle   Arc end in radians (CCW positive)
   * @param offset     Radial distance above the arc for the annotation arc
   */
  static computeArcLengthDimension(
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number,
    offset: number,
  ): ArcLengthDimension {
    // Normalise so endAngle > startAngle (CCW span)
    let end = endAngle;
    while (end <= startAngle) end += 2 * Math.PI;

    const value = r * (end - startAngle);

    const annR = r + offset;
    const midAngle = (startAngle + end) / 2;

    // Text sits a further 2 units out from the annotation arc
    const textR = annR + 2;
    const textPosition: Vec2 = {
      x: cx + textR * Math.cos(midAngle),
      y: cy + textR * Math.sin(midAngle),
    };

    return {
      type: 'arc-length',
      value,
      arcCenter:    { x: cx, y: cy },
      arcRadius:    r,
      startAngle,
      endAngle:     end,
      annotationArc: {
        cx,
        cy,
        r:          annR,
        startAngle,
        endAngle:   end,
      },
      textPosition,
    };
  }

  /**
   * Computes an angle dimension between two rays emanating from a shared vertex.
   *
   * @param vertex   Shared vertex / apex point
   * @param ray1End  End point of the first ray
   * @param ray2End  End point of the second ray
   * @param offset   Radius of the annotation arc (distance from vertex)
   */
  static computeAngleDimension(
    vertex: Vec2,
    ray1End: Vec2,
    ray2End: Vec2,
    offset: number,
  ): AngleDimension {
    const d1 = normalize({ x: ray1End.x - vertex.x, y: ray1End.y - vertex.y });
    const d2 = normalize({ x: ray2End.x - vertex.x, y: ray2End.y - vertex.y });

    // Angle between the two rays (0–180 degrees)
    const dot = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y));
    const value = (Math.acos(dot) * 180) / Math.PI;

    const a1 = Math.atan2(d1.y, d1.x);
    const a2 = Math.atan2(d2.y, d2.x);

    // Ensure the arc sweeps the interior angle (shortest sweep)
    let aStart = a1;
    let aEnd   = a2;
    // Normalise so aEnd is CCW from aStart and the sweep <= π
    if (aEnd < aStart) aEnd += 2 * Math.PI;
    if (aEnd - aStart > Math.PI) {
      // Swap so we draw the smaller arc
      [aStart, aEnd] = [aEnd, aStart + 2 * Math.PI];
    }

    const midAngle = (aStart + aEnd) / 2;
    const textR    = offset + 2;

    return {
      type: 'angle',
      value,
      vertex,
      ray1End,
      ray2End,
      annotationArc: {
        cx:         vertex.x,
        cy:         vertex.y,
        r:          offset,
        startAngle: aStart,
        endAngle:   aEnd,
      },
      textPosition: {
        x: vertex.x + textR * Math.cos(midAngle),
        y: vertex.y + textR * Math.sin(midAngle),
      },
    };
  }

  /**
   * Computes a diameter dimension for a circle entity.
   *
   * @param cx    Circle center X
   * @param cy    Circle center Y
   * @param r     Circle radius
   * @param angle Angle of the diameter line in radians (0 = horizontal)
   */
  static computeDiameterDimension(
    cx: number,
    cy: number,
    r: number,
    angle: number,
  ): DiameterDimension {
    const value = 2 * r;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const dimP1: Vec2 = { x: cx - r * cosA, y: cy - r * sinA };
    const dimP2: Vec2 = { x: cx + r * cosA, y: cy + r * sinA };

    // Offset text slightly above the midpoint of the line
    const perp = { x: -sinA, y: cosA };
    const textPosition: Vec2 = {
      x: cx + perp.x * (r * 0.25),
      y: cy + perp.y * (r * 0.25),
    };

    return {
      type: 'diameter',
      value,
      center: { x: cx, y: cy },
      radius: r,
      dimensionLine: [dimP1, dimP2],
      textPosition,
    };
  }

  /**
   * Formats a dimension value for display.
   *
   * @param value    Value in model units (mm)
   * @param unit     Target display unit: 'mm' | 'cm' | 'in' | 'ft'
   * @param decimals Number of decimal places (default 2)
   */
  static formatDimensionValue(
    value: number,
    unit: 'mm' | 'cm' | 'in' | 'ft' = 'mm',
    decimals = 2,
  ): string {
    let v = value;
    if (unit === 'cm') v /= 10;
    if (unit === 'in') v /= 25.4;
    if (unit === 'ft') v /= 304.8;
    return `${v.toFixed(decimals)} ${unit}`;
  }
}
