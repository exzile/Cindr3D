export interface ImagePoint {
  x: number;
  y: number;
}

export interface BedCorners {
  frontLeft?: ImagePoint;
  frontRight?: ImagePoint;
  backRight?: ImagePoint;
  backLeft?: ImagePoint;
}

export type CompleteBedCorners = Required<BedCorners>;

export type HomographyMatrix = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

type CornerKey = keyof CompleteBedCorners;

const CORNER_KEYS: CornerKey[] = ['frontLeft', 'frontRight', 'backRight', 'backLeft'];
const EPSILON = 1e-9;

export function hasCompleteBedCorners(corners?: BedCorners): corners is CompleteBedCorners {
  return Boolean(corners && CORNER_KEYS.every((key) => Number.isFinite(corners[key]?.x) && Number.isFinite(corners[key]?.y)));
}

function solveLinearSystem(rows: number[][]): number[] | null {
  const size = rows.length;
  const matrix = rows.map((row) => [...row]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(matrix[pivotRow][column]) < EPSILON) return null;

    [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
    const pivot = matrix[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      matrix[column][entry] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        matrix[row][entry] -= factor * matrix[column][entry];
      }
    }
  }

  return matrix.map((row) => row[size]);
}

export function solveCameraHomography(
  corners: BedCorners | undefined,
  bedWidthMm: number | undefined,
  bedDepthMm: number | undefined,
): HomographyMatrix | null {
  if (!hasCompleteBedCorners(corners) || !bedWidthMm || !bedDepthMm || bedWidthMm <= 0 || bedDepthMm <= 0) {
    return null;
  }

  const correspondences: Array<{ image: ImagePoint; bed: ImagePoint }> = [
    { image: corners.frontLeft, bed: { x: 0, y: 0 } },
    { image: corners.frontRight, bed: { x: bedWidthMm, y: 0 } },
    { image: corners.backRight, bed: { x: bedWidthMm, y: bedDepthMm } },
    { image: corners.backLeft, bed: { x: 0, y: bedDepthMm } },
  ];

  const rows = correspondences.flatMap(({ image, bed }) => {
    const { x, y } = image;
    const u = bed.x;
    const v = bed.y;
    return [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    ];
  });
  const solution = solveLinearSystem(rows);
  if (!solution) return null;

  return [
    [solution[0], solution[1], solution[2]],
    [solution[3], solution[4], solution[5]],
    [solution[6], solution[7], 1],
  ];
}

export function projectImagePointToBed(point: ImagePoint, homography: HomographyMatrix): ImagePoint | null {
  const denominator = homography[2][0] * point.x + homography[2][1] * point.y + homography[2][2];
  if (Math.abs(denominator) < EPSILON) return null;
  return {
    x: (homography[0][0] * point.x + homography[0][1] * point.y + homography[0][2]) / denominator,
    y: (homography[1][0] * point.x + homography[1][1] * point.y + homography[1][2]) / denominator,
  };
}

export function invertHomography(homography: HomographyMatrix): HomographyMatrix | null {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = homography;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < EPSILON) return null;
  const inv = 1 / determinant;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

export function projectBedPointToImage(point: ImagePoint, homography: HomographyMatrix): ImagePoint | null {
  const inverse = invertHomography(homography);
  return inverse ? projectImagePointToBed(point, inverse) : null;
}

export function distanceBetweenImagePointsMm(
  start: ImagePoint | undefined,
  end: ImagePoint | undefined,
  homography: HomographyMatrix | null,
): number | null {
  if (!start || !end || !homography) return null;
  const projectedStart = projectImagePointToBed(start, homography);
  const projectedEnd = projectImagePointToBed(end, homography);
  if (!projectedStart || !projectedEnd) return null;
  return Math.hypot(projectedEnd.x - projectedStart.x, projectedEnd.y - projectedStart.y);
}
