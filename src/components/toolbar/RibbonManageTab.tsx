import {
  Diamond, Repeat, FlipHorizontal, Move, RotateCw,
  Maximize2, AlignCenter, Grid3X3, Magnet,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';

const ICON_LG = 28;
const ICON_SM = 18;

export function RibbonManageTab() {
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const setGridVisible = useCADStore((s) => s.setGridVisible);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const setSnapEnabled = useCADStore((s) => s.setSnapEnabled);

  return (
    <>
      <RibbonSection title="PARAMETERS">
        <ToolButton icon={<Diamond size={ICON_LG} />} label="Parameters" onClick={() => setActiveDialog('parameters')} large colorClass="icon-gray" />
      </RibbonSection>
      <RibbonSection title="PATTERN">
        <div className="ribbon-stack">
          <ToolButton icon={<Repeat size={ICON_SM} />} label="Linear" onClick={() => setActiveDialog('linear-pattern')} colorClass="icon-gray" />
          <ToolButton icon={<Repeat size={ICON_SM} />} label="Circular" onClick={() => setActiveDialog('circular-pattern')} colorClass="icon-gray" />
        </div>
        <ToolButton icon={<FlipHorizontal size={ICON_LG} />} label="Mirror" onClick={() => setActiveDialog('mirror')} large colorClass="icon-gray" />
      </RibbonSection>
      <RibbonSection title="TRANSFORM">
        <div className="ribbon-stack">
          <ToolButton icon={<Move size={ICON_SM} />} label="Move" tool="move" colorClass="icon-gray" />
          <ToolButton icon={<RotateCw size={ICON_SM} />} label="Rotate" tool="rotate" colorClass="icon-gray" />
        </div>
        <div className="ribbon-stack">
          <ToolButton icon={<Maximize2 size={ICON_SM} />} label="Scale" onClick={() => setActiveDialog('scale')} colorClass="icon-gray" />
          <ToolButton icon={<AlignCenter size={ICON_SM} />} label="Align" tool="align" colorClass="icon-gray" />
        </div>
      </RibbonSection>
      <RibbonSection title="DISPLAY">
        <ToolButton icon={<Grid3X3 size={ICON_LG} />} label="Grid" active={gridVisible} onClick={() => setGridVisible(!gridVisible)} large colorClass="icon-gray" />
        <ToolButton icon={<Magnet size={ICON_LG} />} label="Snap" active={snapEnabled} onClick={() => setSnapEnabled(!snapEnabled)} large colorClass="icon-gray" />
      </RibbonSection>
    </>
  );
}
