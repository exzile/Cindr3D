export type ChamferMode =
  | "equal-dist"
  | "two-dist"
  | "dist-angle"
  | "three-face";

export type ChamferCornerType = "patch" | "miter";

export interface ChamferParams {
  mode: ChamferMode;
  distance: number;
  distance2?: number;
  angle?: number;
  edgeIds: string[];
  propagate: boolean;
  isFlipped?: boolean;
  cornerType?: ChamferCornerType;
}
