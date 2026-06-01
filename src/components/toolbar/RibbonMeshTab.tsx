import {
  Box, FolderOpen, Scissors, CircleDot,
  Blend, RefreshCw, SplitSquareHorizontal, Combine,
  Trash2, FlipHorizontal, AlignCenter, Unlink, Move,
  Package, Link2, MousePointer2, ShieldCheck,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem } from '../../types/toolbar.types';
import type { RefObject, ChangeEvent } from 'react';

const ICON_LG = 28;
const MI = 16;

interface RibbonMeshTabProps {
  meshInsertInputRef: RefObject<HTMLInputElement | null>;
  onMeshInsert: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function RibbonMeshTab({ meshInsertInputRef, onMeshInsert }: RibbonMeshTabProps) {
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);

  const createMenuItems: MenuItem[] = [
    { icon: <Box size={MI} />, ribbonIcon: <Box size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Tessellate', onClick: () => setActiveDialog('tessellate') },
    { icon: <FolderOpen size={MI} />, ribbonIcon: <FolderOpen size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Insert Mesh', onClick: () => meshInsertInputRef.current?.click() },
    { icon: <Scissors size={MI} />, ribbonIcon: <Scissors size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Section Sketch', onClick: () => setActiveDialog('mesh-section-sketch') },
    { icon: <CircleDot size={MI} />, ribbonIcon: <CircleDot size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Primitives', onClick: () => setActiveDialog('mesh-primitives') },
  ];

  const modifyMenuItems: MenuItem[] = [
    { icon: <Blend size={MI} />, ribbonIcon: <Blend size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Reduce', onClick: () => setActiveDialog('mesh-reduce') },
    { icon: <RefreshCw size={MI} />, ribbonIcon: <RefreshCw size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Remesh', onClick: () => setActiveDialog('remesh') },
    { icon: <ShieldCheck size={MI} />, ribbonIcon: <ShieldCheck size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Repair', onClick: () => setActiveDialog('mesh-repair') },
    { icon: <SplitSquareHorizontal size={MI} />, ribbonIcon: <SplitSquareHorizontal size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Plane Cut', onClick: () => setActiveDialog('plane-cut') },
    { icon: <Combine size={MI} />, ribbonIcon: <Combine size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Make Closed', onClick: () => setActiveDialog('make-closed-mesh') },
    { icon: <Trash2 size={MI} />, ribbonIcon: <Trash2 size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Erase & Fill', onClick: () => setActiveDialog('erase-and-fill') },
    { icon: <Blend size={MI} />, ribbonIcon: <Blend size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Smooth', onClick: () => setActiveDialog('mesh-smooth') },
    { icon: <Box size={MI} />, ribbonIcon: <Box size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Shell', onClick: () => setActiveDialog('mesh-shell') },
    { icon: <Link2 size={MI} />, ribbonIcon: <Link2 size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Combine', onClick: () => setActiveDialog('mesh-combine') },
    { icon: <FlipHorizontal size={MI} />, ribbonIcon: <FlipHorizontal size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Reverse Normal', onClick: () => setActiveDialog('mesh-reverse-normal') },
    { icon: <AlignCenter size={MI} />, ribbonIcon: <AlignCenter size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Align', onClick: () => setActiveDialog('mesh-align') },
    { icon: <Unlink size={MI} />, ribbonIcon: <Unlink size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Separate', onClick: () => setActiveDialog('mesh-separate') },
    { icon: <Move size={MI} />, ribbonIcon: <Move size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'Transform', onClick: () => setActiveDialog('mesh-transform') },
    { icon: <Package size={MI} />, ribbonIcon: <Package size={ICON_LG} />, ribbonColorClass: 'icon-purple', promoteToRibbon: true, label: 'To BRep', onClick: () => setActiveDialog('convert-mesh-to-brep') },
  ];

  return (
    <>
      <input
        ref={meshInsertInputRef}
        type="file"
        accept=".stl,.obj,.3mf,.gltf,.glb"
        hidden
        onChange={onMeshInsert}
      />
      <RibbonSection title="CREATE" menuItems={createMenuItems} accentColor="#7b1fa2" maxVisible={3}>
        <ToolButton icon={<Box size={ICON_LG} />} label="Tessellate" onClick={() => setActiveDialog('tessellate')} large colorClass="icon-purple" />
        <ToolButton icon={<FolderOpen size={ICON_LG} />} label="Insert Mesh" onClick={() => meshInsertInputRef.current?.click()} large colorClass="icon-purple" />
        <ToolButton icon={<Scissors size={ICON_LG} />} label="Section Sketch" onClick={() => setActiveDialog('mesh-section-sketch')} large colorClass="icon-purple" />
        <ToolButton icon={<CircleDot size={ICON_LG} />} label="Primitives" onClick={() => setActiveDialog('mesh-primitives')} large colorClass="icon-purple" />
      </RibbonSection>
      <RibbonSection title="MODIFY" menuItems={modifyMenuItems} accentColor="#7b1fa2" maxVisible={5}>
        <ToolButton icon={<Blend size={ICON_LG} />} label="Reduce" onClick={() => setActiveDialog('mesh-reduce')} large colorClass="icon-purple" />
        <ToolButton icon={<RefreshCw size={ICON_LG} />} label="Remesh" onClick={() => setActiveDialog('remesh')} large colorClass="icon-purple" />
        <ToolButton icon={<ShieldCheck size={ICON_LG} />} label="Repair" onClick={() => setActiveDialog('mesh-repair')} large colorClass="icon-purple" />
        <ToolButton icon={<SplitSquareHorizontal size={ICON_LG} />} label="Plane Cut" onClick={() => setActiveDialog('plane-cut')} large colorClass="icon-purple" />
        <ToolButton icon={<Combine size={ICON_LG} />} label="Make Closed" onClick={() => setActiveDialog('make-closed-mesh')} large colorClass="icon-purple" />
        <ToolButton icon={<Trash2 size={ICON_LG} />} label="Erase &amp; Fill" onClick={() => setActiveDialog('erase-and-fill')} large colorClass="icon-purple" />
        <ToolButton icon={<Blend size={ICON_LG} />} label="Smooth" onClick={() => setActiveDialog('mesh-smooth')} large colorClass="icon-purple" />
        <ToolButton icon={<Box size={ICON_LG} />} label="Shell" onClick={() => setActiveDialog('mesh-shell')} large colorClass="icon-purple" />
        <ToolButton icon={<Link2 size={ICON_LG} />} label="Combine" onClick={() => setActiveDialog('mesh-combine')} large colorClass="icon-purple" />
        <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Reverse Normal" onClick={() => setActiveDialog('mesh-reverse-normal')} large colorClass="icon-purple" />
        <ToolButton icon={<AlignCenter size={ICON_LG} />} label="Align" onClick={() => setActiveDialog('mesh-align')} large colorClass="icon-purple" />
        <ToolButton icon={<Unlink size={ICON_LG} />} label="Separate" onClick={() => setActiveDialog('mesh-separate')} large colorClass="icon-purple" />
        <ToolButton icon={<Move size={ICON_LG} />} label="Transform" onClick={() => setActiveDialog('mesh-transform')} large colorClass="icon-purple" />
        <ToolButton icon={<Package size={ICON_LG} />} label="To BRep" onClick={() => setActiveDialog('convert-mesh-to-brep')} large colorClass="icon-purple" />
      </RibbonSection>
      <RibbonSection title="SELECT">
        <ToolButton icon={<MousePointer2 size={ICON_LG} />} label="Select" tool="select" large colorClass="icon-blue" />
      </RibbonSection>
    </>
  );
}
