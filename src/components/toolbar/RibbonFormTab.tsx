import {
  Box, Square, Circle, CircleDot, Repeat, Diamond,
  Spline, PenTool, ArrowUpFromLine, RotateCw, Waypoints,
  Layers, Move, Minus, Grid3X3, Link2, Target, Combine,
  Blend, Maximize2, AlignCenter, Equal, Tangent, Package,
  Trash2, MousePointer2,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem } from '../../types/toolbar.types';

const ICON_LG = 28;
const MI = 16;

export function RibbonFormTab() {
  const setActiveTool = useCADStore((s) => s.setActiveTool);

  const createMenuItems: MenuItem[] = [
    { icon: <Box size={MI} />, ribbonIcon: <Box size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-box', promoteToRibbon: true, label: 'Box', onClick: () => setActiveTool('form-box') },
    { icon: <Square size={MI} />, ribbonIcon: <Square size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-plane', promoteToRibbon: true, label: 'Plane', onClick: () => setActiveTool('form-plane') },
    { icon: <Circle size={MI} />, ribbonIcon: <Circle size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-cylinder', promoteToRibbon: true, label: 'Cylinder', onClick: () => setActiveTool('form-cylinder') },
    { icon: <CircleDot size={MI} />, ribbonIcon: <CircleDot size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-sphere', promoteToRibbon: true, label: 'Sphere', onClick: () => setActiveTool('form-sphere') },
    { icon: <Repeat size={MI} />, ribbonIcon: <Repeat size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-torus', promoteToRibbon: true, label: 'Torus', onClick: () => setActiveTool('form-torus') },
    { icon: <Diamond size={MI} />, ribbonIcon: <Diamond size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-quadball', promoteToRibbon: true, label: 'Quadball', onClick: () => setActiveTool('form-quadball') },
    { icon: <Spline size={MI} />, ribbonIcon: <Spline size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-pipe', promoteToRibbon: true, label: 'Pipe', onClick: () => setActiveTool('form-pipe') },
    { icon: <PenTool size={MI} />, ribbonIcon: <PenTool size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-face', promoteToRibbon: true, label: 'Face', onClick: () => setActiveTool('form-face') },
    { icon: <ArrowUpFromLine size={MI} />, ribbonIcon: <ArrowUpFromLine size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-extrude', promoteToRibbon: true, label: 'Extrude', onClick: () => setActiveTool('form-extrude') },
    { icon: <RotateCw size={MI} />, ribbonIcon: <RotateCw size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-revolve', promoteToRibbon: true, label: 'Revolve', onClick: () => setActiveTool('form-revolve') },
    { icon: <Waypoints size={MI} />, ribbonIcon: <Waypoints size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-sweep', promoteToRibbon: true, label: 'Sweep', onClick: () => setActiveTool('form-sweep') },
    { icon: <Layers size={MI} />, ribbonIcon: <Layers size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-loft', promoteToRibbon: true, label: 'Loft', onClick: () => setActiveTool('form-loft') },
  ];

  const modifyMenuItems: MenuItem[] = [
    { icon: <Move size={MI} />, ribbonIcon: <Move size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-edit', promoteToRibbon: true, label: 'Edit Form', onClick: () => setActiveTool('form-edit') },
    { icon: <Minus size={MI} />, ribbonIcon: <Minus size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-insert-edge', promoteToRibbon: true, label: 'Insert Edge', onClick: () => setActiveTool('form-insert-edge') },
    { icon: <Diamond size={MI} />, ribbonIcon: <Diamond size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-insert-point', promoteToRibbon: true, label: 'Insert Point', onClick: () => setActiveTool('form-insert-point') },
    { icon: <Grid3X3 size={MI} />, ribbonIcon: <Grid3X3 size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-subdivide', promoteToRibbon: true, label: 'Subdivide', onClick: () => setActiveTool('form-subdivide') },
    { icon: <Link2 size={MI} />, ribbonIcon: <Link2 size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-bridge', promoteToRibbon: true, label: 'Bridge', onClick: () => setActiveTool('form-bridge') },
    { icon: <Target size={MI} />, ribbonIcon: <Target size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-fill-hole', promoteToRibbon: true, label: 'Fill Hole', onClick: () => setActiveTool('form-fill-hole') },
    { icon: <Combine size={MI} />, ribbonIcon: <Combine size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-weld', promoteToRibbon: true, label: 'Weld', onClick: () => setActiveTool('form-weld') },
    { icon: <Blend size={MI} />, ribbonIcon: <Blend size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-unweld', promoteToRibbon: true, label: 'Unweld', onClick: () => setActiveTool('form-unweld') },
    { icon: <Maximize2 size={MI} />, ribbonIcon: <Maximize2 size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-crease', promoteToRibbon: true, label: 'Crease', onClick: () => setActiveTool('form-crease') },
    { icon: <Blend size={MI} />, ribbonIcon: <Blend size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-uncrease', promoteToRibbon: true, label: 'Uncrease', onClick: () => setActiveTool('form-uncrease') },
    { icon: <AlignCenter size={MI} />, ribbonIcon: <AlignCenter size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-flatten', promoteToRibbon: true, label: 'Flatten', onClick: () => setActiveTool('form-flatten') },
    { icon: <Equal size={MI} />, ribbonIcon: <Equal size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-uniform', promoteToRibbon: true, label: 'Uniform', onClick: () => setActiveTool('form-uniform') },
    { icon: <ArrowUpFromLine size={MI} />, ribbonIcon: <ArrowUpFromLine size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-pull', promoteToRibbon: true, label: 'Pull', onClick: () => setActiveTool('form-pull') },
    { icon: <Tangent size={MI} />, ribbonIcon: <Tangent size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-interpolate', promoteToRibbon: true, label: 'Interpolate', onClick: () => setActiveTool('form-interpolate') },
    { icon: <Layers size={MI} />, ribbonIcon: <Layers size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-thicken', promoteToRibbon: true, label: 'Thicken', onClick: () => setActiveTool('form-thicken') },
    { icon: <Package size={MI} />, ribbonIcon: <Package size={ICON_LG} />, ribbonColorClass: 'icon-orange', ribbonTool: 'form-freeze', promoteToRibbon: true, label: 'Freeze', onClick: () => setActiveTool('form-freeze') },
    { icon: <Trash2 size={MI} />, ribbonIcon: <Trash2 size={ICON_LG} />, ribbonColorClass: 'icon-red', ribbonTool: 'form-delete', promoteToRibbon: true, label: 'Delete', onClick: () => setActiveTool('form-delete') },
  ];

  return (
    <>
      <RibbonSection title="CREATE" menuItems={createMenuItems} accentColor="#ff6b00" maxVisible={6}>
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

      <RibbonSection title="MODIFY" menuItems={modifyMenuItems} accentColor="#ff6b00" maxVisible={6}>
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
