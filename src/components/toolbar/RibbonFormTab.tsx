import {
  Box, Square, Circle, CircleDot, Repeat, Diamond,
  Spline, PenTool, ArrowUpFromLine, RotateCw, Waypoints,
  Layers, Move, Minus, Grid3X3, Link2, Target, Combine,
  Blend, Maximize2, AlignCenter, Equal, Tangent, Package,
  Trash2, MousePointer2,
} from 'lucide-react';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';

const ICON_LG = 28;

export function RibbonFormTab() {
  return (
    <>
      {/* CREATE panel — T-Spline primitives */}
      <RibbonSection title="CREATE">
        <ToolButton icon={<Box size={ICON_LG} />} label="Box" tool="form-box" large colorClass="icon-orange" />
        <ToolButton icon={<Square size={ICON_LG} />} label="Plane" tool="form-plane" large colorClass="icon-orange" />
        <ToolButton icon={<Circle size={ICON_LG} />} label="Cylinder" tool="form-cylinder" large colorClass="icon-orange" />
        <ToolButton icon={<CircleDot size={ICON_LG} />} label="Sphere" tool="form-sphere" large colorClass="icon-orange" />
        <ToolButton icon={<Repeat size={ICON_LG} />} label="Torus" tool="form-torus" large colorClass="icon-orange" />
        <ToolButton icon={<Diamond size={ICON_LG} />} label="Quadball" tool="form-quadball" large colorClass="icon-orange" />
        <ToolButton icon={<Spline size={ICON_LG} />} label="Pipe" tool="form-pipe" large colorClass="icon-orange" />
        <ToolButton icon={<PenTool size={ICON_LG} />} label="Face" tool="form-face" large colorClass="icon-orange" />
        <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Extrude" tool="form-extrude" large colorClass="icon-orange" />
        <ToolButton icon={<RotateCw size={ICON_LG} />} label="Revolve" tool="form-revolve" large colorClass="icon-orange" />
        <ToolButton icon={<Waypoints size={ICON_LG} />} label="Sweep" tool="form-sweep" large colorClass="icon-orange" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Loft" tool="form-loft" large colorClass="icon-orange" />
      </RibbonSection>

      {/* MODIFY panel */}
      <RibbonSection title="MODIFY">
        <ToolButton icon={<Move size={ICON_LG} />} label="Edit Form" tool="form-edit" large colorClass="icon-orange" />
        <ToolButton icon={<Minus size={ICON_LG} />} label="Insert Edge" tool="form-insert-edge" large colorClass="icon-orange" />
        <ToolButton icon={<Diamond size={ICON_LG} />} label="Insert Point" tool="form-insert-point" large colorClass="icon-orange" />
        <ToolButton icon={<Grid3X3 size={ICON_LG} />} label="Subdivide" tool="form-subdivide" large colorClass="icon-orange" />
        <ToolButton icon={<Link2 size={ICON_LG} />} label="Bridge" tool="form-bridge" large colorClass="icon-orange" />
        <ToolButton icon={<Target size={ICON_LG} />} label="Fill Hole" tool="form-fill-hole" large colorClass="icon-orange" />
        <ToolButton icon={<Combine size={ICON_LG} />} label="Weld" tool="form-weld" large colorClass="icon-orange" />
        <ToolButton icon={<Blend size={ICON_LG} />} label="Unweld" tool="form-unweld" large colorClass="icon-orange" />
        <ToolButton icon={<Maximize2 size={ICON_LG} />} label="Crease" tool="form-crease" large colorClass="icon-orange" />
        <ToolButton icon={<Blend size={ICON_LG} />} label="Uncrease" tool="form-uncrease" large colorClass="icon-orange" />
        <ToolButton icon={<AlignCenter size={ICON_LG} />} label="Flatten" tool="form-flatten" large colorClass="icon-orange" />
        <ToolButton icon={<Equal size={ICON_LG} />} label="Uniform" tool="form-uniform" large colorClass="icon-orange" />
        <ToolButton icon={<ArrowUpFromLine size={ICON_LG} />} label="Pull" tool="form-pull" large colorClass="icon-orange" />
        <ToolButton icon={<Tangent size={ICON_LG} />} label="Interpolate" tool="form-interpolate" large colorClass="icon-orange" />
        <ToolButton icon={<Layers size={ICON_LG} />} label="Thicken" tool="form-thicken" large colorClass="icon-orange" />
        <ToolButton icon={<Package size={ICON_LG} />} label="Freeze" tool="form-freeze" large colorClass="icon-orange" />
        <ToolButton icon={<Trash2 size={ICON_LG} />} label="Delete" tool="form-delete" large colorClass="icon-red" />
      </RibbonSection>

      <RibbonSection title="SELECT">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
