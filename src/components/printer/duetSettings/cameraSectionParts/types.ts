import type * as React from "react";
import type { CameraTestState } from "../cameraSectionHelpers";

export type SetSaved = (value: boolean) => void;
export type SetTestState = React.Dispatch<
  React.SetStateAction<CameraTestState>
>;
