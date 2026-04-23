import {
  AlignCenter,
  ArrowLeftRight,
  ArrowUpDown,
  ArrowUpFromLine,
  Blend,
  Box,
  Circle,
  CircleDot,
  Copy,
  CornerDownRight,
  Crosshair,
  Dot,
  Download,
  Equal,
  FlipHorizontal,
  GitMerge,
  Hexagon,
  Layers,
  Lock,
  LocateFixed,
  Minus,
  MousePointer2,
  Move,
  Package,
  PenTool,
  RectangleHorizontal,
  Repeat,
  RotateCcw,
  Ruler,
  Scissors,
  Spline,
  Square,
  Tangent,
  Type,
  Waypoints,
  Zap,
} from 'lucide-react';
import type { MenuItem } from '../../types/toolbar.types';
import type { SketchMenuDeps } from './menuBuilderTypes';

const MI = 16;

export function buildSketchMenus({
  autoConstrainSketch,
  comingSoon,
  selectionFilter,
  setActiveTool,
  setSelectionFilter,
  setStatusMessage,
  startSketchProjectSurfaceTool,
  startSketchTextTool,
}: SketchMenuDeps) {
  const sf = selectionFilter;
  const isBodyPriority = sf.bodies && !sf.faces && !sf.edges && !sf.vertices;
  const isFacePriority = sf.faces && !sf.bodies && !sf.edges && !sf.vertices;
  const isEdgePriority = sf.edges && !sf.bodies && !sf.faces && !sf.vertices;
  const isVertexPriority = sf.vertices && !sf.bodies && !sf.faces && !sf.edges;

  const setPriority = (filter: Partial<typeof sf>, label: string) => {
    setSelectionFilter({ bodies: false, faces: false, edges: false, vertices: false, ...filter });
    setStatusMessage(`Selection priority: ${label}`);
  };

  const selectMenuItems: MenuItem[] = [
    { icon: <MousePointer2 size={MI} />, label: 'Select', onClick: () => setActiveTool('select') },
    { icon: <Square size={MI} />, label: 'Window Selection', shortcut: '1', onClick: comingSoon('Window Selection') },
    { icon: <Spline size={MI} />, label: 'Freeform Selection', shortcut: '2', onClick: comingSoon('Freeform Selection') },
    { icon: <PenTool size={MI} />, label: 'Paint Selection', shortcut: '3', onClick: comingSoon('Paint Selection') },
    {
      separator: true,
      icon: <MousePointer2 size={MI} />,
      label: 'Selection Priority',
      submenu: [
        { icon: <Box size={MI} />, label: 'Body Priority', checked: isBodyPriority, onClick: () => isBodyPriority ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ bodies: true }, 'Body') },
        { icon: <Package size={MI} />, label: 'Component Priority', checked: isBodyPriority, onClick: () => isBodyPriority ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ bodies: true }, 'Component') },
        { icon: <Square size={MI} />, label: 'Face Priority', checked: isFacePriority, onClick: () => isFacePriority ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ faces: true }, 'Face') },
        { icon: <Minus size={MI} />, label: 'Edge Priority', checked: isEdgePriority, onClick: () => isEdgePriority ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ edges: true }, 'Edge') },
        { icon: <Dot size={MI} />, label: 'Vertex Priority', checked: isVertexPriority, onClick: () => isVertexPriority ? setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true }) : setPriority({ vertices: true }, 'Vertex') },
      ],
    },
    { separator: true, icon: <MousePointer2 size={MI} />, label: 'Select All', onClick: () => { setSelectionFilter({ bodies: true, faces: true, edges: true, vertices: true, sketches: true, construction: true }); setStatusMessage('Selection filter: All'); } },
    { icon: <Box size={MI} />, label: 'Bodies', checked: sf.bodies, onClick: () => setSelectionFilter({ bodies: !sf.bodies }) },
    { icon: <Square size={MI} />, label: 'Faces', checked: sf.faces, onClick: () => setSelectionFilter({ faces: !sf.faces }) },
    { icon: <Minus size={MI} />, label: 'Edges', checked: sf.edges, onClick: () => setSelectionFilter({ edges: !sf.edges }) },
    { icon: <Dot size={MI} />, label: 'Vertices', checked: sf.vertices, onClick: () => setSelectionFilter({ vertices: !sf.vertices }) },
    { icon: <PenTool size={MI} />, label: 'Sketches', checked: sf.sketches, onClick: () => setSelectionFilter({ sketches: !sf.sketches }) },
    { icon: <Layers size={MI} />, label: 'Construction', checked: sf.construction, onClick: () => setSelectionFilter({ construction: !sf.construction }) },
  ];

  const sketchCreateMenuItems: MenuItem[] = [
    {
      icon: <Minus size={MI} />, label: 'Line', shortcut: 'L',
      submenu: [
        { icon: <Minus size={MI} />, label: 'Line', shortcut: 'L', onClick: () => setActiveTool('line') },
        { icon: <Minus size={MI} />, label: 'Construction Line', onClick: () => setActiveTool('construction-line') },
        { icon: <Minus size={MI} />, label: 'Centerline', onClick: () => setActiveTool('centerline') },
        { icon: <Minus size={MI} />, label: 'Midpoint Line', onClick: () => { setActiveTool('midpoint-line'); setStatusMessage('Midpoint Line: click the midpoint, then one endpoint'); } },
      ],
    },
    {
      icon: <Square size={MI} />, label: 'Rectangle', shortcut: 'R',
      submenu: [
        { icon: <RectangleHorizontal size={MI} />, label: '2-Point Rectangle', shortcut: 'R', onClick: () => setActiveTool('rectangle') },
        { icon: <Square size={MI} />, label: '3-Point Rectangle', onClick: () => setActiveTool('rectangle-3point') },
        { icon: <Crosshair size={MI} />, label: 'Center Rectangle', onClick: () => setActiveTool('rectangle-center') },
      ],
    },
    {
      icon: <Circle size={MI} />, label: 'Circle', shortcut: 'C',
      submenu: [
        { icon: <Circle size={MI} />, label: 'Center Diameter Circle', shortcut: 'C', onClick: () => setActiveTool('circle') },
        { icon: <Circle size={MI} />, label: '2-Point Circle', onClick: () => setActiveTool('circle-2point') },
        { icon: <Circle size={MI} />, label: '3-Point Circle', onClick: () => setActiveTool('circle-3point') },
        { icon: <Circle size={MI} />, label: '2-Tangent Circle', onClick: () => { setActiveTool('circle-2tangent'); setStatusMessage('2-Tangent Circle: click first line, then second line — set radius in palette'); } },
        { icon: <Circle size={MI} />, label: '3-Tangent Circle', onClick: () => { setActiveTool('circle-3tangent'); setStatusMessage('3-Tangent Circle: click three lines to create the incircle'); } },
      ],
    },
    {
      icon: <Spline size={MI} />, label: 'Arc',
      submenu: [
        { icon: <Spline size={MI} />, label: '3-Point Arc', onClick: () => setActiveTool('arc-3point') },
        { icon: <Spline size={MI} />, label: 'Center Point Arc', onClick: () => setActiveTool('arc') },
        { icon: <Spline size={MI} />, label: 'Tangent Arc', onClick: () => setActiveTool('arc-tangent') },
      ],
    },
    {
      icon: <Hexagon size={MI} />, label: 'Polygon',
      submenu: [
        { icon: <Hexagon size={MI} />, label: 'Inscribed Polygon', onClick: () => setActiveTool('polygon-inscribed') },
        { icon: <Hexagon size={MI} />, label: 'Circumscribed Polygon', onClick: () => setActiveTool('polygon-circumscribed') },
        { icon: <Hexagon size={MI} />, label: 'Edge Polygon', onClick: () => setActiveTool('polygon-edge') },
      ],
    },
    {
      separator: true, icon: <CircleDot size={MI} />, label: 'Ellipse',
      onClick: () => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); },
      submenu: [
        { icon: <CircleDot size={MI} />, label: 'Ellipse', onClick: () => { setActiveTool('ellipse'); setStatusMessage('Ellipse: click centre, then major-axis, then minor-axis endpoint'); } },
        { icon: <CircleDot size={MI} />, label: 'Elliptical Arc', onClick: () => { setActiveTool('elliptical-arc'); setStatusMessage('Elliptical Arc: click centre, major-axis, minor-axis, then end angle point'); } },
      ],
    },
    {
      icon: <Circle size={MI} />, label: 'Slot',
      submenu: [
        { icon: <Circle size={MI} />, label: 'Center to Center Slot', onClick: () => { setActiveTool('slot-center'); setStatusMessage('Center Slot: click first centre, then second centre, then width'); } },
        { icon: <Circle size={MI} />, label: 'Overall Slot', onClick: () => { setActiveTool('slot-overall'); setStatusMessage('Overall Slot: click first end, then second end, then width'); } },
        { icon: <Circle size={MI} />, label: 'Center Point Slot', onClick: () => { setActiveTool('slot-center-point'); setStatusMessage('Center Point Slot: click centre, then end, then width'); } },
        { icon: <Circle size={MI} />, label: 'Three Point Arc Slot', onClick: () => { setActiveTool('slot-3point-arc'); setStatusMessage('Three Point Arc Slot: click arc start, arc end, point on arc, then width'); } },
        { icon: <Circle size={MI} />, label: 'Center Point Arc Slot', onClick: () => { setActiveTool('slot-center-arc'); setStatusMessage('Center Point Arc Slot: click arc centre, arc start, arc end, then width'); } },
      ],
    },
    {
      separator: true, icon: <Waypoints size={MI} />, label: 'Spline', onClick: () => { setActiveTool('spline'); setStatusMessage('Spline: click to place fit points, right-click to finish'); },
      submenu: [
        { icon: <Waypoints size={MI} />, label: 'Fit Point Spline', onClick: () => { setActiveTool('spline'); setStatusMessage('Spline: click to place fit points, right-click to finish'); } },
        { icon: <Waypoints size={MI} />, label: 'Control Point Spline', onClick: () => { setActiveTool('spline-control'); setStatusMessage('Control Point Spline: click to add control points, right-click to commit'); } },
      ],
    },
    { icon: <Waypoints size={MI} />, label: 'Conic Curve', onClick: () => { setActiveTool('conic'); setStatusMessage('Conic: click start, then end, then shoulder point — set ρ in palette'); } },
    { separator: true, icon: <CircleDot size={MI} />, label: 'Point', onClick: () => setActiveTool('point') },
    { separator: true, icon: <ArrowUpFromLine size={MI} />, label: 'Project / Include', shortcut: 'P', onClick: () => { setActiveTool('sketch-project'); setStatusMessage('Project: click a solid face to project its boundary onto the sketch plane'); } },
    { icon: <Scissors size={MI} />, label: 'Intersect', onClick: () => { setActiveTool('sketch-intersect'); setStatusMessage('Click a solid face to create intersection curve with sketch plane'); } },
    { icon: <Download size={MI} />, label: 'Project to Surface', onClick: startSketchProjectSurfaceTool },
    { separator: true, icon: <Type size={MI} />, label: 'Text', onClick: startSketchTextTool },
  ];

  const sketchModifyMenuItems: MenuItem[] = [
    { icon: <Blend size={MI} />, label: 'Fillet', shortcut: 'F', onClick: () => { setActiveTool('sketch-fillet'); setStatusMessage('Sketch Fillet: click near the corner of two intersecting lines'); } },
    { icon: <Minus size={MI} />, label: 'Linetype', onClick: () => { setActiveTool('linetype-convert'); setStatusMessage('Linetype Convert: click a line to cycle Normal → Construction → Centerline'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Equal)', onClick: () => { setActiveTool('sketch-chamfer-equal'); setStatusMessage('Sketch Chamfer: click near a corner to chamfer — set distance in palette'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Two Dist)', onClick: () => { setActiveTool('sketch-chamfer-two-dist'); setStatusMessage('Sketch Chamfer: click near a corner — set Dist 1 and Dist 2 in palette'); } },
    { icon: <Blend size={MI} />, label: 'Chamfer (Dist+Angle)', onClick: () => { setActiveTool('sketch-chamfer-dist-angle'); setStatusMessage('Sketch Chamfer: click near a corner — set Dist and Angle in palette'); } },
    { icon: <Blend size={MI} />, label: 'Blend Curve', onClick: () => { setActiveTool('blend-curve'); setStatusMessage('Blend Curve: click near an endpoint of a sketch entity, then click a second endpoint'); } },
    { icon: <Scissors size={MI} />, label: 'Trim', shortcut: 'T', onClick: () => { setActiveTool('trim'); setStatusMessage('Trim: click a segment portion to remove it'); } },
    { icon: <Move size={MI} />, label: 'Extend', onClick: () => { setActiveTool('extend'); setStatusMessage('Extend: click near an endpoint of a line to extend it to the nearest intersection'); } },
    { icon: <Scissors size={MI} />, label: 'Break', onClick: () => { setActiveTool('break'); setStatusMessage('Break: click on a line to split it at that point'); } },
    { separator: true, icon: <Copy size={MI} />, label: 'Offset', shortcut: 'O', onClick: () => { setActiveTool('sketch-offset'); setStatusMessage('Offset: click a line, then click the side to offset towards'); } },
    { icon: <FlipHorizontal size={MI} />, label: 'Mirror', onClick: () => { setActiveTool('sketch-mirror'); setStatusMessage('Mirror: select axis direction, then click OK'); } },
    { separator: true, icon: <Repeat size={MI} />, label: 'Circular Pattern', onClick: () => { setActiveTool('sketch-circ-pattern'); setStatusMessage('Circular Pattern: set count and angle, then click OK'); } },
    { icon: <Repeat size={MI} />, label: 'Rectangular Pattern', onClick: () => { setActiveTool('sketch-rect-pattern'); setStatusMessage('Rectangular Pattern: set counts and spacing, then click OK'); } },
    { icon: <Repeat size={MI} />, label: 'Pattern on Path', onClick: () => { setActiveTool('sketch-path-pattern'); setStatusMessage('Pattern on Path: select a path curve, set count, then click OK'); } },
    { separator: true, icon: <Move size={MI} />, label: 'Move', shortcut: 'M', onClick: () => { setActiveTool('sketch-move'); setStatusMessage('Move: set X/Y offset in plane-local coords, then click OK'); } },
    { icon: <Copy size={MI} />, label: 'Copy', onClick: () => { setActiveTool('sketch-copy'); setStatusMessage('Copy: set X/Y offset, then click OK to duplicate entities'); } },
    { icon: <Move size={MI} />, label: 'Scale', onClick: () => { setActiveTool('sketch-scale'); setStatusMessage('Scale: set factor about centroid, then click OK'); } },
    { icon: <RotateCcw size={MI} />, label: 'Rotate', onClick: () => { setActiveTool('sketch-rotate'); setStatusMessage('Rotate: set angle about centroid, then click OK'); } },
  ];

  const sketchConstraintMenuItems: MenuItem[] = [
    { icon: <Ruler size={MI} />, label: 'Sketch Dimension', shortcut: 'D', onClick: () => setActiveTool('dimension') },
    { separator: true, icon: <AlignCenter size={MI} />, label: 'Coincident', onClick: () => { setActiveTool('constrain-coincident'); setStatusMessage('Coincident: click two entities to apply constraint'); } },
    { icon: <Minus size={MI} />, label: 'Collinear', onClick: () => { setActiveTool('constrain-collinear'); setStatusMessage('Collinear: click two lines to apply constraint'); } },
    { icon: <CircleDot size={MI} />, label: 'Concentric', onClick: () => { setActiveTool('constrain-concentric'); setStatusMessage('Concentric: click two circles/arcs to apply constraint'); } },
    { icon: <LocateFixed size={MI} />, label: 'Midpoint', onClick: () => { setActiveTool('constrain-midpoint'); setStatusMessage('Midpoint: click a point and a line to apply constraint'); } },
    { separator: true, icon: <ArrowLeftRight size={MI} />, label: 'Horizontal', onClick: () => { setActiveTool('constrain-horizontal'); setStatusMessage('Horizontal: click a line or two points to apply constraint'); } },
    { icon: <ArrowUpDown size={MI} />, label: 'Vertical', onClick: () => { setActiveTool('constrain-vertical'); setStatusMessage('Vertical: click a line or two points to apply constraint'); } },
    { icon: <CornerDownRight size={MI} />, label: 'Perpendicular', onClick: () => { setActiveTool('constrain-perpendicular'); setStatusMessage('Perpendicular: click two lines to apply constraint'); } },
    { icon: <Minus size={MI} />, label: 'Parallel', onClick: () => { setActiveTool('constrain-parallel'); setStatusMessage('Parallel: click two lines to apply constraint'); } },
    { icon: <Tangent size={MI} />, label: 'Tangent', onClick: () => { setActiveTool('constrain-tangent'); setStatusMessage('Tangent: click two curves to apply constraint'); } },
    { separator: true, icon: <Equal size={MI} />, label: 'Equal', onClick: () => { setActiveTool('constrain-equal'); setStatusMessage('Equal: click two entities to apply constraint'); } },
    { icon: <FlipHorizontal size={MI} />, label: 'Symmetric', onClick: () => { setActiveTool('constrain-symmetric'); setStatusMessage('Symmetric: click two entities and a symmetry line'); } },
    { icon: <Lock size={MI} />, label: 'Fix / Unfix', onClick: () => { setActiveTool('constrain-fix'); setStatusMessage('Fix: click an entity to fix its position'); } },
    { icon: <GitMerge size={MI} />, label: 'Curvature (G2)', onClick: () => { setActiveTool('constrain-curvature'); setStatusMessage('Curvature (G2): click two splines sharing a point to apply G2 continuity'); } },
    { separator: true, icon: <Zap size={MI} />, label: 'AutoConstrain', onClick: autoConstrainSketch },
  ];

  return { selectMenuItems, sketchCreateMenuItems, sketchModifyMenuItems, sketchConstraintMenuItems };
}
