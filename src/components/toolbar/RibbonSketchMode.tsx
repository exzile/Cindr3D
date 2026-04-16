import {
  PenLine, RectangleHorizontal, Circle, Spline, Hexagon, CircleDot,
  Waypoints, ArrowUpFromLine, Scissors, Download, Type,
  CornerDownRight, Blend, ChevronsRight, Copy, FlipHorizontal2,
  Move, Ruler, AlignCenter, Minus, Lock, Tangent, Equal,
  LocateFixed, FlipHorizontal, GitMerge, Zap,
  Grid3X3, Magnet, FileUp, MousePointer2, Square, Crosshair,
  ArrowLeftRight, ArrowUpDown,
  Check, ChevronDown, X,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { RibbonSection } from './FlyoutMenu';
import { ToolButton } from './ToolButton';
import type { MenuItem, Tool } from './toolbar.types';
import type { Tool as CADTool } from '../../types/cad';

const ICON_SM = 18;

interface RibbonSketchModeProps {
  sketchCreateMenuItems: MenuItem[];
  sketchModifyMenuItems: MenuItem[];
  sketchConstraintMenuItems: MenuItem[];
}

// Re-export Tool for convenience inside this file
type T = CADTool;

export function RibbonSketchMode({
  sketchCreateMenuItems,
  sketchModifyMenuItems,
  sketchConstraintMenuItems,
}: RibbonSketchModeProps) {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const finishSketch = useCADStore((s) => s.finishSketch);
  const cancelSketch = useCADStore((s) => s.cancelSketch);
  const autoConstrainSketch = useCADStore((s) => s.autoConstrainSketch);
  const startSketchTextTool = useCADStore((s) => s.startSketchTextTool);
  const startSketchProjectSurfaceTool = useCADStore((s) => s.startSketchProjectSurfaceTool);
  const sketchGridEnabled = useCADStore((s) => s.sketchGridEnabled);
  const setSketchGridEnabled = useCADStore((s) => s.setSketchGridEnabled);
  const sketchSnapEnabled = useCADStore((s) => s.sketchSnapEnabled);
  const setSketchSnapEnabled = useCADStore((s) => s.setSketchSnapEnabled);

  return (
    <>
      {/* ── CREATE ─────────────────────────────────── */}
      <RibbonSection title="CREATE" menuItems={sketchCreateMenuItems} accentColor="#0078d7">
        <ToolButton
          icon={<PenLine size={20} />}
          label="Line"
          tool="line"
          colorClass="icon-blue"
        />
        <ToolButton
          icon={<RectangleHorizontal size={20} />}
          label="Rectangle"
          active={['rectangle', 'rectangle-3point', 'rectangle-center'].includes(activeTool)}
          onClick={() => setActiveTool('rectangle' as T)}
          colorClass="icon-blue"
          dropdown={[
            { label: '2-Point Rectangle', icon: <RectangleHorizontal size={14} />, onClick: () => setActiveTool('rectangle' as T) },
            { label: '3-Point Rectangle', icon: <Square size={14} />, onClick: () => setActiveTool('rectangle-3point' as T) },
            { label: 'Center Rectangle', icon: <Crosshair size={14} />, onClick: () => setActiveTool('rectangle-center' as T) },
          ]}
        />
        <ToolButton
          icon={<Circle size={20} />}
          label="Circle"
          active={['circle', 'circle-2point', 'circle-3point'].includes(activeTool)}
          onClick={() => setActiveTool('circle' as T)}
          colorClass="icon-blue"
          dropdown={[
            { label: 'Center Diameter Circle', icon: <Circle size={14} />, onClick: () => setActiveTool('circle' as T) },
            { label: '2-Point Circle', icon: <Circle size={14} />, onClick: () => setActiveTool('circle-2point' as T) },
            { label: '3-Point Circle', icon: <Circle size={14} />, onClick: () => setActiveTool('circle-3point' as T) },
          ]}
        />
        <ToolButton
          icon={<Spline size={20} />}
          label="Arc"
          active={['arc', 'arc-3point', 'arc-tangent'].includes(activeTool)}
          onClick={() => setActiveTool('arc-3point' as T)}
          colorClass="icon-blue"
          dropdown={[
            { label: '3-Point Arc', icon: <Spline size={14} />, onClick: () => setActiveTool('arc-3point' as T) },
            { label: 'Center Point Arc', icon: <Spline size={14} />, onClick: () => setActiveTool('arc' as T) },
            { label: 'Tangent Arc', icon: <Spline size={14} />, onClick: () => setActiveTool('arc-tangent' as T) },
          ]}
        />
        <ToolButton
          icon={<Hexagon size={20} />}
          label="Polygon"
          active={['polygon', 'polygon-inscribed', 'polygon-circumscribed', 'polygon-edge'].includes(activeTool)}
          onClick={() => setActiveTool('polygon-inscribed' as T)}
          colorClass="icon-blue"
          dropdown={[
            { label: 'Inscribed Polygon', icon: <Hexagon size={14} />, onClick: () => setActiveTool('polygon-inscribed' as T) },
            { label: 'Circumscribed Polygon', icon: <Hexagon size={14} />, onClick: () => setActiveTool('polygon-circumscribed' as T) },
            { label: 'Edge Polygon', icon: <Hexagon size={14} />, onClick: () => setActiveTool('polygon-edge' as T) },
          ]}
        />
        <ToolButton
          icon={<CircleDot size={20} />}
          label="Ellipse"
          active={activeTool === 'ellipse' || activeTool === 'elliptical-arc'}
          onClick={() => { setActiveTool('ellipse' as T); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); }}
          colorClass="icon-blue"
          dropdown={[
            { label: 'Ellipse', icon: <CircleDot size={14} />, onClick: () => { setActiveTool('ellipse' as T); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); } },
            { label: 'Elliptical Arc', icon: <CircleDot size={14} />, onClick: () => { setActiveTool('elliptical-arc' as T); setStatusMessage('Elliptical Arc: click centre, major-axis, minor-axis, then end angle point'); } },
          ]}
        />
        <ToolButton icon={<CircleDot size={20} />} label="Point" tool="point" colorClass="icon-blue" />
        <ToolButton
          icon={<Waypoints size={20} />}
          label="Spline"
          onClick={() => { setActiveTool('spline' as T); setStatusMessage('Spline: click to place fit points, right-click to finish'); }}
          colorClass="icon-blue"
          dropdown={[
            { label: 'Fit Point Spline', icon: <Waypoints size={14} />, onClick: () => { setActiveTool('spline' as T); setStatusMessage('Spline: click to place fit points, right-click to finish'); } },
            { label: 'Control Point Spline', icon: <Waypoints size={14} />, onClick: () => { setActiveTool('spline-control' as T); setStatusMessage('Control Point Spline: click to add control points, right-click to commit'); } },
          ]}
        />
        <ToolButton icon={<ArrowUpFromLine size={20} />} label="Project" active={activeTool === 'sketch-project'} onClick={() => { setActiveTool('sketch-project' as T); setStatusMessage('Project: click a solid face to project its boundary onto the sketch plane'); }} colorClass="icon-blue" />
        <ToolButton icon={<Scissors size={20} />} label="Intersect" active={activeTool === 'sketch-intersect'} onClick={() => { setActiveTool('sketch-intersect' as T); setStatusMessage('Click a solid face to create intersection curve with sketch plane'); }} colorClass="icon-blue" />
        <ToolButton icon={<Download size={20} />} label="Proj Surface" active={activeTool === 'sketch-project-surface'} onClick={startSketchProjectSurfaceTool} colorClass="icon-blue" />
        <ToolButton icon={<Type size={20} />} label="Text" active={activeTool === 'sketch-text'} onClick={startSketchTextTool} colorClass="icon-blue" />
      </RibbonSection>

      {/* ── MODIFY ─────────────────────────────────── */}
      <RibbonSection title="MODIFY" menuItems={sketchModifyMenuItems} accentColor="#0078d7">
        <ToolButton icon={<CornerDownRight size={20} />} label="Fillet" onClick={() => { setActiveTool('sketch-fillet' as T); setStatusMessage('Sketch Fillet: click near the corner of two lines'); }} colorClass="icon-blue" />
        <ToolButton icon={<Blend size={20} />} label="Chamfer" onClick={() => { setActiveTool('sketch-chamfer-equal' as T); setStatusMessage('Sketch Chamfer: click near a corner — set distance in palette'); }} colorClass="icon-blue" />
        <ToolButton icon={<Scissors size={20} />} label="Trim" onClick={() => { setActiveTool('trim' as T); setStatusMessage('Trim: click a segment portion to remove it'); }} colorClass="icon-blue" />
        <ToolButton icon={<ChevronsRight size={20} />} label="Extend" onClick={() => { setActiveTool('extend' as T); setStatusMessage('Extend: click near an endpoint to extend to nearest intersection'); }} colorClass="icon-blue" />
        <ToolButton icon={<Copy size={20} />} label="Offset" active={activeTool === 'sketch-offset'} onClick={() => { setActiveTool('sketch-offset' as T); setStatusMessage('Offset: click a line, then click the side to offset towards'); }} colorClass="icon-blue" />
        <ToolButton icon={<FlipHorizontal2 size={20} />} label="Mirror" active={activeTool === 'sketch-mirror'} onClick={() => { setActiveTool('sketch-mirror' as T); setStatusMessage('Mirror: select axis direction, then click OK'); }} colorClass="icon-blue" />
        <ToolButton icon={<Move size={20} />} label="Move" onClick={() => { setActiveTool('sketch-move' as T); setStatusMessage('Move: set X/Y offset, then click OK'); }} colorClass="icon-blue" />
      </RibbonSection>

      {/* ── CONSTRAINTS ────────────────────────────── */}
      <RibbonSection title="CONSTRAINTS" menuItems={sketchConstraintMenuItems} accentColor="#ff6b00">
        <ToolButton icon={<Ruler size={20} />} label="Dimension" tool="dimension" colorClass="icon-orange" />
        <ToolButton icon={<AlignCenter size={20} />} label="Coincident" active={activeTool === 'constrain-coincident'} onClick={() => { setActiveTool('constrain-coincident' as T); setStatusMessage('Coincident: click two entities to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<Minus size={20} />} label="Collinear" active={activeTool === 'constrain-collinear'} onClick={() => { setActiveTool('constrain-collinear' as T); setStatusMessage('Collinear: click two lines to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<CircleDot size={20} />} label="Concentric" active={activeTool === 'constrain-concentric'} onClick={() => { setActiveTool('constrain-concentric' as T); setStatusMessage('Concentric: click two circles/arcs to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<Lock size={20} />} label="Fix" active={activeTool === 'constrain-fix'} onClick={() => { setActiveTool('constrain-fix' as T); setStatusMessage('Fix: click an entity to fix its position'); }} colorClass="icon-orange" />
        <ToolButton icon={<Minus size={20} />} label="Parallel" active={activeTool === 'constrain-parallel'} onClick={() => { setActiveTool('constrain-parallel' as T); setStatusMessage('Parallel: click two lines to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<CornerDownRight size={20} />} label="Perpendicular" active={activeTool === 'constrain-perpendicular'} onClick={() => { setActiveTool('constrain-perpendicular' as T); setStatusMessage('Perpendicular: click two lines to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<ArrowLeftRight size={20} />} label="Horizontal" active={activeTool === 'constrain-horizontal'} onClick={() => { setActiveTool('constrain-horizontal' as T); setStatusMessage('Horizontal: click a line or two points to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<ArrowUpDown size={20} />} label="Vertical" active={activeTool === 'constrain-vertical'} onClick={() => { setActiveTool('constrain-vertical' as T); setStatusMessage('Vertical: click a line or two points to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<Tangent size={20} />} label="Tangent" active={activeTool === 'constrain-tangent'} onClick={() => { setActiveTool('constrain-tangent' as T); setStatusMessage('Tangent: click two curves to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<Equal size={20} />} label="Equal" active={activeTool === 'constrain-equal'} onClick={() => { setActiveTool('constrain-equal' as T); setStatusMessage('Equal: click two entities to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<LocateFixed size={20} />} label="Midpoint" active={activeTool === 'constrain-midpoint'} onClick={() => { setActiveTool('constrain-midpoint' as T); setStatusMessage('Midpoint: click a point and a line to apply constraint'); }} colorClass="icon-orange" />
        <ToolButton icon={<FlipHorizontal size={20} />} label="Symmetric" active={activeTool === 'constrain-symmetric'} onClick={() => { setActiveTool('constrain-symmetric' as T); setStatusMessage('Symmetric: click two entities and a symmetry line'); }} colorClass="icon-orange" />
        <ToolButton icon={<GitMerge size={20} />} label="Curvature (G2)" active={activeTool === 'constrain-curvature'} onClick={() => { setActiveTool('constrain-curvature' as T); setStatusMessage('Curvature (G2): click two splines sharing a point to apply G2 continuity'); }} colorClass="icon-orange" />
        <ToolButton icon={<Zap size={20} />} label="AutoConstrain" onClick={() => autoConstrainSketch()} colorClass="icon-orange" />
      </RibbonSection>

      {/* ── CONFIGURE ──────────────────────────────── */}
      <RibbonSection title="CONFIGURE" accentColor="#555">
        <div className="ribbon-stack">
          <ToolButton icon={<Grid3X3 size={ICON_SM} />} label="Grid" active={sketchGridEnabled} onClick={() => { setSketchGridEnabled(!sketchGridEnabled); setStatusMessage(`Sketch grid: ${sketchGridEnabled ? 'OFF' : 'ON'}`); }} colorClass="icon-gray" />
          <ToolButton icon={<Magnet size={ICON_SM} />} label="Snap" active={sketchSnapEnabled} onClick={() => { setSketchSnapEnabled(!sketchSnapEnabled); setStatusMessage(`Sketch snap: ${sketchSnapEnabled ? 'OFF' : 'ON'}`); }} colorClass="icon-gray" />
        </div>
      </RibbonSection>

      {/* ── INSPECT ────────────────────────────────── */}
      <RibbonSection title="INSPECT" accentColor="#555">
        <div className="ribbon-stack">
          <ToolButton icon={<Ruler size={ICON_SM} />} label="Measure" tool="measure" colorClass="icon-gray" />
        </div>
      </RibbonSection>

      {/* ── INSERT ─────────────────────────────────── */}
      <RibbonSection title="INSERT" accentColor="#555">
        <div className="ribbon-stack">
          <ToolButton icon={<FileUp size={ICON_SM} />} label="Insert SVG" onClick={() => setActiveDialog('insert-svg')} colorClass="icon-gray" />
          <ToolButton icon={<FileUp size={ICON_SM} />} label="Insert DXF" onClick={() => setActiveDialog('insert-dxf')} colorClass="icon-gray" />
          <ToolButton icon={<FileUp size={ICON_SM} />} label="Insert Canvas" onClick={() => setActiveDialog('insert-canvas')} colorClass="icon-gray" />
        </div>
      </RibbonSection>

      {/* ── SELECT ─────────────────────────────────── */}
      <RibbonSection title="SELECT" accentColor="#555">
        <ToolButton icon={<MousePointer2 size={20} />} label="Select" tool="select" colorClass="icon-blue" />
      </RibbonSection>

      {/* ── FINISH SKETCH ──────────────────────────── */}
      <div className="sketch-finish-area">
        <button className="sketch-finish-btn" onClick={finishSketch} title="Finish Sketch">
          <Check size={15} />
          <span>FINISH SKETCH</span>
          <ChevronDown size={11} className="sketch-finish-chevron" />
        </button>
        <button className="sketch-cancel-btn" onClick={cancelSketch} title="Cancel Sketch">
          <X size={13} />
        </button>
      </div>
    </>
  );
}
