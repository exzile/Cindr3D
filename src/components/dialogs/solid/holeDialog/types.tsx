import {
  SimpleHoleIcon,
  CounterboreIcon,
  CountersinkIcon,
  TapSimpleIcon,
  TapClearanceIcon,
  TapTappedIcon,
  TapTaperTappedIcon,
  DrillFlatIcon,
  DrillAngledIcon,
} from '../HoleIcons';

export type HoleType = 'simple' | 'counterbore' | 'countersink';
export type TapType = 'simple' | 'clearance' | 'tapped' | 'taper-tapped';
export type DrillPoint = 'flat' | 'angled';
export type HoleTermination = 'blind' | 'through-all' | 'to-object' | 'to-face';
export type Placement = 'single' | 'multiple' | 'plane-offsets' | 'on-edge';

export const HOLE_TYPE_OPTIONS = [
  { value: 'simple' as const, icon: <SimpleHoleIcon />, title: 'Simple' },
  { value: 'counterbore' as const, icon: <CounterboreIcon />, title: 'Counterbore' },
  { value: 'countersink' as const, icon: <CountersinkIcon />, title: 'Countersink' },
];

export const TAP_TYPE_OPTIONS = [
  { value: 'simple' as const, icon: <TapSimpleIcon />, title: 'Simple' },
  { value: 'clearance' as const, icon: <TapClearanceIcon />, title: 'Clearance' },
  { value: 'tapped' as const, icon: <TapTappedIcon />, title: 'Tapped' },
  { value: 'taper-tapped' as const, icon: <TapTaperTappedIcon />, title: 'Taper Tapped' },
];

export const DRILL_POINT_OPTIONS = [
  { value: 'flat' as const, icon: <DrillFlatIcon />, title: 'Flat' },
  { value: 'angled' as const, icon: <DrillAngledIcon />, title: 'Angled' },
];

export const PLACEMENT_OPTIONS = [
  {
    value: 'single' as const,
    title: 'Single Hole',
    icon: (
      <svg width={14} height={14} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <rect x={2} y={2} width={14} height={14} />
        <circle cx={9} cy={9} r={2.5} />
      </svg>
    ),
  },
  {
    value: 'multiple' as const,
    title: 'Multiple Holes',
    icon: (
      <svg width={14} height={14} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <rect x={2} y={2} width={14} height={14} />
        <circle cx={6} cy={6} r={1.5} />
        <circle cx={12} cy={6} r={1.5} />
        <circle cx={6} cy={12} r={1.5} />
        <circle cx={12} cy={12} r={1.5} />
      </svg>
    ),
  },
  {
    value: 'plane-offsets' as const,
    title: 'By Plane Offsets',
    icon: (
      <svg width={14} height={14} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <rect x={2} y={2} width={14} height={14} />
        <line x1={7} y1={2} x2={7} y2={16} strokeDasharray="2,1.5" />
        <line x1={2} y1={7} x2={16} y2={7} strokeDasharray="2,1.5" />
        <circle cx={10} cy={10} r={2} />
      </svg>
    ),
  },
  {
    value: 'on-edge' as const,
    title: 'On Edge',
    icon: (
      <svg width={14} height={14} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <line x1={2} y1={9} x2={16} y2={9} />
        <circle cx={9} cy={9} r={2.5} />
        <line x1={2} y1={6} x2={2} y2={12} />
        <line x1={16} y1={6} x2={16} y2={12} />
      </svg>
    ),
  },
];
