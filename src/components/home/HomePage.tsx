import {
  ArrowUp,
  BrainCircuit,
  CameraOff,
  ChevronRight,
  Code2,
  Cpu,
  ExternalLink,
  Film,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers3,
  ListChecks,
  Menu,
  MoveHorizontal,
  Printer,
  Rocket,
  Shapes,
  Sparkles,
  SwitchCamera,
  Timer,
  Usb,
  Video,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import './HomePage.css';

const workflows = [
  {
    title: 'Design',
    copy: 'Sketch parts, build parametric features, organize components, and export models from a browser-based CAD workspace.',
    image: '/help/help-design-overview.png',
    color: '#7c3aed',
    sections: [
      {
        label: 'Sketcher',
        items: [
          'Constraint-based 2D sketcher with dimensions and geometric snaps',
          'Coincident, tangent, parallel, perpendicular, and equal constraints',
          'Point, line, arc, circle, spline, rectangle, and polygon tools',
          'Sketch references and projection from 3D geometry',
        ],
      },
      {
        label: 'Solid modeling',
        items: [
          'Extrude, revolve, sweep, and loft from closed sketches',
          'Shell, fillet, chamfer, draft, and taper operations',
          'Boolean union, subtract, and intersect between bodies',
          'Mirror and pattern (linear, circular) for repeated geometry',
        ],
      },
      {
        label: 'Organization',
        items: [
          'Parametric feature timeline with rollback and reorder',
          'Component tree with visibility toggling and grouping',
          'Per-body material and color assignment',
          'Named views and section planes for inspection',
        ],
      },
      {
        label: 'Import and export',
        items: [
          'Import STEP, STL, OBJ, and native project files',
          'Export STEP, STL, OBJ with per-body or full-assembly options',
          'Measurement tools, mass properties, and bounding box readouts',
        ],
      },
    ],
  },
  {
    title: 'Prepare',
    copy: 'Arrange parts on the plate, tune print profiles, inspect sliced toolpaths, and generate labeled G-code for object cancellation.',
    image: '/help/help-prepare-overview.png',
    color: '#0284c7',
    sections: [
      {
        label: 'Plate layout',
        items: [
          'Drag-and-drop multi-part arrangement with snap and align guides',
          'Rotate, scale, and mirror parts on the build plate',
          'Auto-arrange to pack parts efficiently',
          'Per-part color coding for object cancellation identification',
        ],
      },
      {
        label: 'Slicing',
        items: [
          'In-browser WASM slicing kernels — no cloud upload required',
          'Print profiles: layer height, speed, temperature, walls, infill, supports',
          'Bridging, overhangs, seam placement, and retraction controls',
          'Per-object profile overrides for mixed-material or mixed-quality plates',
        ],
      },
      {
        label: 'Preview and inspection',
        items: [
          'Animated G-code preview with per-layer scrubbing',
          'Move-type highlighting: perimeter, infill, travel, support, bridge',
          'Layer time and filament usage estimates per layer',
          'Zoom and rotate the 3D toolpath preview freely',
        ],
      },
      {
        label: 'Calibration and output',
        items: [
          'Flow, pressure advance, resonance, and first-layer calibration utilities',
          'M486 and EXCLUDE_OBJECT label generation for mid-print cancellation',
          'Export labeled G-code ready for Duet, Klipper, or Marlin',
        ],
      },
    ],
  },
  {
    title: 'Print',
    copy: 'Connect printers, monitor jobs, manage files, queue work across a fleet, and control firmware-specific features from one panel.',
    image: '/help/help-printer-fleet.png',
    color: '#059669',
    sections: [
      {
        label: 'Firmware support',
        items: [
          'Duet / RepRapFirmware — full RRF API, object model, and DWC parity',
          'Klipper / Moonraker — native API, klippy config, pressure advance, input shaper',
          'Marlin — USB serial via WebSerial, no driver install or software bridge',
          'Unified UI surface — same controls work across all three firmwares',
        ],
      },
      {
        label: 'Printer control',
        items: [
          'File manager — upload, rename, delete, and start print jobs',
          'Macro library, interactive G-code console, and manual movement controls',
          'Heater control, fan overrides, and power management',
          'Spool and filament tracking with per-print usage estimates',
          'Real-time layer progress, ETA, and object cancellation from the dashboard',
        ],
      },
      {
        label: 'Camera and monitoring',
        items: [
          'Live MJPEG and WebRTC streams with sub-second latency',
          'Multi-camera per printer: top, side, nozzle, and custom tab views',
          'ONVIF PTZ control with D-pad and saved preset positions',
          'All-cameras fleet grid with per-tile status and alert overlays',
          'Automatic per-layer photo gallery with ZIP export',
        ],
      },
      {
        label: 'Fleet and queue',
        items: [
          'Smart job queue with drag-reorder and auto-routing rules',
          'Route by build volume, material loaded, nozzle size, and profile compatibility',
          'Distribute N copies across available printers in one action',
          'Cross-printer A/B comparison — timing and quality side-by-side',
          'Filament inventory across the fleet with low-stock warnings',
        ],
      },
    ],
  },
];

const useSteps = [
  'Open the app and start in Design to sketch, import, or edit a part.',
  'Switch to Prepare to arrange the plate, slice, and inspect the generated toolpath.',
  'Move to 3D Printer to connect hardware, queue jobs, monitor cameras, and manage print-farm work.',
  'Use the Help button inside the app for guided screenshots and firmware-specific setup notes.',
];

const stats = [
  { value: '3', label: 'Firmware targets', sub: 'Duet · Klipper · Marlin' },
  { value: '29', label: 'AI / MCP tools', sub: 'CAD · Slicer · Printer' },
  { value: '100%', label: 'Browser-native', sub: 'No install · No cloud' },
  { value: 'MIT', label: 'Open source license', sub: 'Fork · Extend · Self-host' },
  { value: 'WASM', label: 'In-browser slicing', sub: 'No upload required' },
];

const whyItems = [
  {
    icon: Layers3,
    color: '#7c3aed',
    tag: 'No other tool does this',
    title: 'CAD → slicer → printer in one browser tab',
    body: 'OctoPrint, Mainsail, and Fluidd only cover printing. PrusaSlicer and OrcaSlicer only cover slicing. Cindr3D combines parametric CAD design, in-browser slicing, and full printer control in a single workspace — no app switching, no file exports between tools.',
  },
  {
    icon: Cpu,
    color: '#0284c7',
    tag: 'Slicer',
    title: 'WASM slicing — your file never leaves your machine',
    body: 'The slicing engine runs entirely in the browser via WebAssembly. There is no cloud upload, no account, and no waiting on a server. Slice in the same tab you designed in, inspect the toolpath, and send G-code directly to your printer — all offline-capable.',
  },
  {
    icon: ListChecks,
    color: '#059669',
    tag: 'Slicer + Print',
    title: 'Object cancellation wired end-to-end',
    body: 'The slicer automatically emits M486 and EXCLUDE_OBJECT labels per object. In the printer panel, cancellation is surfaced in three places: a dedicated tab, the live dashboard list, and a 3D print-preview viewport with right-click context menus. Works on Duet ≥ 3.5, Marlin ≥ 2.0.9, and all Klipper versions.',
  },
  {
    icon: Shapes,
    color: '#0f7c83',
    tag: 'Print farm',
    title: 'Smart queue that routes jobs to the right printer',
    body: 'The job queue auto-routes by build volume, loaded material, nozzle size, and profile compatibility. Distribute N copies across available printers in one click. Drag-reorder, move jobs mid-print, and pause the entire fleet. No other open-source tool matches this.',
  },
  {
    icon: SwitchCamera,
    color: '#d97706',
    tag: 'Print farm',
    title: 'A/B cross-printer comparison',
    body: 'Run the same G-code on two printers in parallel, then get a side-by-side timing dashboard showing per-layer deltas and a summary of which printer is faster or more consistent. Unique to Cindr3D.',
  },
  {
    icon: Film,
    color: '#dc2626',
    tag: 'Camera',
    title: 'Per-layer photo gallery with ZIP export',
    body: 'A snapshot is captured automatically on every layer change, keyed by printer, job, and layer number. Scroll through the gallery to find exactly when a failure started. Export the full set as a ZIP for archival or time-lapse post-processing.',
  },
  {
    icon: BrainCircuit,
    color: '#9333ea',
    tag: 'AI',
    title: 'AI that actually executes — not just advises',
    body: 'The local MCP bridge gives Claude, GPT-4, or any MCP-compatible client real control over 29 tools: create geometry, adjust slicer profiles, trigger a slice, start or cancel a print. Other tools let AI answer questions. Cindr3D lets AI do the work.',
  },
  {
    icon: Wifi,
    color: '#475569',
    tag: 'Architecture',
    title: 'Direct to hardware — no relay, no cloud, no subscription',
    body: 'All communication is browser-to-printer over your LAN. Your G-code, camera feeds, and settings never leave your network. MIT licensed with no tiers, no telemetry, and no account required.',
  },
];

const faqs = [
  {
    q: 'Do I need a 3D printer to use it?',
    a: 'No. The CAD workspace, slicer, G-code preview, and AI tools all work in the browser without any hardware. Connect a printer when you are ready — or use it purely as a browser CAD and slicer tool.',
  },
  {
    q: 'Which firmwares are supported?',
    a: 'Duet / RepRapFirmware (via the RRF HTTP API), Klipper / Moonraker (via the Moonraker REST API), and Marlin (via WebSerial over USB). The same control panel UI works across all three.',
  },
  {
    q: 'What cameras work?',
    a: 'Any camera that serves an MJPEG stream or a WebRTC endpoint. PTZ control works with ONVIF-compatible cameras including Reolink, Tapo, Hikvision, and Amcrest. Per-layer snapshots work with any reachable stream URL.',
  },
  {
    q: 'Is it really free?',
    a: 'Yes. MIT license — you can use it, fork it, modify it, and self-host it for free. There are no tiers, no paid plans, and no telemetry.',
  },
  {
    q: 'How do I self-host it?',
    a: 'Build the project with `npm run build`, then serve the `dist` folder from any static host. For Orange Pi, the included auto-updater script installs a systemd service that polls GitHub releases and updates automatically.',
  },
  {
    q: 'How does the AI integration work?',
    a: 'A local MCP (Model Context Protocol) server starts alongside the dev server. Any MCP-compatible client — Claude Desktop, Cursor, or the built-in chat panel — can call 29 tools covering CAD creation, slicing, and printer control. You bring your own API key.',
  },
];

const v2Highlights = [
  {
    icon: BrainCircuit,
    label: 'AI assistant + MCP bridge',
    detail: 'Local MCP server with token-paired auth and a 29-tool surface covering primitives, sketches, features, booleans, transforms, and export. BYOK chat panel supporting Anthropic and OpenAI/OpenRouter streaming.',
  },
  {
    icon: Zap,
    label: 'Cross-firmware unification',
    detail: 'Bed Map, Exclude Object, Input Shaper, Pressure Advance, Spools, Timelapse, Power, and Updates all routed through universal wrappers that delegate to Duet/RRF, Klipper/Moonraker, Marlin/USB, and others.',
  },
  {
    icon: ListChecks,
    label: 'Mid-print object cancellation',
    detail: 'Surfaced in three places: a dedicated tab, the dashboard list, and a 3D preview viewport with right-click menus. Supports M486 (Duet >= 3.5, Marlin >= 2.0.9) and EXCLUDE_OBJECT (Klipper). Slicer emits labels automatically.',
  },
  {
    icon: Gauge,
    label: 'Cross-firmware layer awareness',
    detail: 'Moonraker getPrintStatus() for live progress. Duet serial parses M73 and echo:Layer N/M into the unified model so layer counters and ETAs work identically across all firmware targets.',
  },
  {
    icon: Film,
    label: 'Print farm foundations',
    detail: 'Smart queue with drag-reorder, auto-routing, and copy-distribution across printers. All-cameras grid with per-tile overlays, PTZ presets, multi-camera per printer, and a per-layer photo gallery with ZIP export.',
  },
  {
    icon: MoveHorizontal,
    label: 'A/B cross-printer comparison',
    detail: 'Run the same G-code on two printers in parallel, compare side-by-side layer timing deltas, and produce a quality report on which printer is faster or more consistent.',
  },
];

const milestones = [
  {
    phase: 'Phase 8',
    icon: CameraOff,
    title: 'Vision and AI diagnostics',
    items: [
      'Failure detection — spaghetti, layer-shift, blob-of-doom, adhesion with auto-pause',
      '"What\'s wrong with my print?" AI diagnostics aggregating frames, temps, and slicer timing',
      'Auto-tune wizards for pressure advance, retraction, temperature, and first-layer squish',
      'Camera measurement tool with homography-based real-world distance readout',
    ],
  },
  {
    phase: 'Phase 9',
    icon: SwitchCamera,
    title: 'AR camera overlay',
    items: [
      'Toolpath wireframe composited over the live camera feed at full frame rate',
      'Right-click object cancel from the camera view using inverse-projected bed coordinates',
      'Post-print AR comparison: frozen final frame with model wireframe overlay and mismatch highlights',
    ],
  },
  {
    phase: 'Phase 10',
    icon: Zap,
    title: 'Cost and energy tracking',
    items: [
      'Cost-per-print from filament price and smart-plug wattage with live ticker',
      'Off-peak scheduling with TOU rate editor and optional utility API integration',
      'Solar-aware printing gated on Powerwall / Enphase / SolarEdge surplus',
      'Sustainability dashboard: kg filament, kWh, CO2 estimates with CSV export',
    ],
  },
  {
    phase: 'Phase 11',
    icon: Timer,
    title: 'Maintenance lifecycle',
    items: [
      'Calibration aging dashboard with recommended re-cal intervals and overdue alerts',
      'Wear tracking for belts, bearings, nozzles, and hotends with full service log',
      'Filament moisture model with ambient humidity tracking and pre-print drying warnings',
    ],
  },
  {
    phase: 'Phase 12',
    icon: FlaskConical,
    title: 'Scheduling and integrations',
    items: [
      'Print scheduling calendar with drag-to-schedule and quiet-hours awareness',
      'Webhook, Discord, Slack, Telegram, and MQTT notifications',
      'HomeAssistant entity bridge and profile import from Cura / OrcaSlicer / Bambu Studio',
      'Chamber temperature monitoring and control for ABS / ASA / PC enclosures',
    ],
  },
  {
    phase: 'Phases 13-14',
    icon: Code2,
    title: 'Polish and platform',
    items: [
      'PWA mode — installable, offline-capable, custom splash screen',
      'Mobile and tablet UI with bottom-sheet nav and one-thumb kiosk mode',
      'i18n, accessibility audit, high-contrast theme, and reduced-motion mode',
      'Profile versioning with diff viewer and cherry-pick restore',
    ],
  },
];

function ReleaseRoadmapTabs() {
  type ReleaseTab = 'shipped' | 'roadmap';
  const [tab, setTab] = useState<ReleaseTab>('shipped');

  function handleKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setTab((current) => current === 'shipped' ? 'roadmap' : 'shipped');
  }
  return (
    <section className="home-band home-band--release" id="v2" aria-labelledby="release-title">
      <div className="rrtabs" style={{ width: 'min(1180px, calc(100% - 40px))', margin: '0 auto' }}>
        <div className="rrtabs__head">
          <div className="home-section-heading" style={{ margin: 0 }}>
            <p>{tab === 'shipped' ? 'Released May 2026' : "What's coming next"}</p>
            <h2 id="release-title">{tab === 'shipped' ? 'What shipped in 2.0' : 'Upcoming milestones'}</h2>
          </div>
          <div className="rrtabs__nav" role="tablist">
            <button role="tab" aria-selected={tab === 'shipped'} className={`rrtabs__tab${tab === 'shipped' ? ' rrtabs__tab--active' : ''}`} onClick={() => setTab('shipped')} onKeyDown={handleKey}>
              ✓ Shipped in 2.0
            </button>
            <button role="tab" aria-selected={tab === 'roadmap'} className={`rrtabs__tab${tab === 'roadmap' ? ' rrtabs__tab--active' : ''}`} onClick={() => setTab('roadmap')} onKeyDown={handleKey}>
              ◎ Roadmap
            </button>
          </div>
        </div>

        {tab === 'shipped' && (
          <div className="v2-grid">
            {v2Highlights.map((h) => {
              const Icon = h.icon;
              return (
                <article className="v2-card" key={h.label}>
                  <div className="v2-card__icon"><Icon size={18} /></div>
                  <div>
                    <h3>{h.label}</h3>
                    <p>{h.detail}</p>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {tab === 'roadmap' && (
          <div className="roadmap-grid">
            {milestones.map((m) => {
              const Icon = m.icon;
              return (
                <article className="roadmap-card" key={m.phase}>
                  <div className="roadmap-card__header">
                    <span className="roadmap-card__phase"><Rocket size={12} />{m.phase}</span>
                  </div>
                  <div className="roadmap-card__title-row">
                    <Icon size={18} className="roadmap-card__icon" />
                    <h3>{m.title}</h3>
                  </div>
                  <ul>
                    {m.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkspaceTabs() {
  const [active, setActive] = useState(0);
  const wf = workflows[active];

  function handleKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setActive((current) =>
      e.key === 'ArrowRight'
        ? (current + 1) % workflows.length
        : (current - 1 + workflows.length) % workflows.length,
    );
  }

  return (
    <div className="wstabs" style={{ '--ws-color': wf.color } as React.CSSProperties}>
      <div className="wstabs__nav" role="tablist">
        {workflows.map((w, i) => (
          <button
            key={w.title}
            role="tab"
            aria-selected={i === active}
            className={`wstabs__tab${i === active ? ' wstabs__tab--active' : ''}`}
            style={i === active ? { '--ws-color': w.color } as React.CSSProperties : undefined}
            onClick={() => setActive(i)}
            onKeyDown={handleKey}
          >
            {w.title}
          </button>
        ))}
      </div>
      <div className="wstabs__panel" key={active}>
        <div className="wstabs__media">
          <img src={wf.image} alt={`${wf.title} workspace`} />
        </div>
        <div className="wstabs__body">
          <p className="wstabs__copy">{wf.copy}</p>
          <div className="wstabs__sections">
            {wf.sections.map((section) => (
              <div key={section.label} className="wstabs__section">
                <p className="wstabs__section-label">{section.label}</p>
                <ul className="wstabs__list">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>('section[id], div[id]');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActiveSection(e.target.id); });
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = [
    { href: '#workflows', label: 'Workflows' },
    { href: '#why', label: 'Why Cindr3D' },
    { href: '#v2', label: 'Release' },
    { href: '#faq', label: 'FAQ' },
    { href: '#how-to-use', label: 'Get started' },
  ];

  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__media" aria-hidden="true" />
        <nav className="home-nav" aria-label="Site navigation">
          <a className="home-nav__brand" href="/home">
            <img src="/logo.png" alt="" />
            <span>Cindr3D</span>
          </a>
          <div className={`home-nav__links${menuOpen ? ' home-nav__links--open' : ''}`}>
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={activeSection === l.href.slice(1) ? 'home-nav__link--active' : ''}
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </a>
            ))}
            <a href="/" className="home-button home-button--primary home-nav__cta" style={{ minHeight: 32, padding: '0 14px', fontSize: 13 }}>
              Open app
            </a>
          </div>
          <button
            className="home-nav__burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>
        <div className="home-hero__content">
          <div className="home-hero__left">
            <div className="home-hero__brand">
              <img src="/logo.png" alt="" className="home-hero__logo" aria-hidden="true" />
              <h1 id="home-hero-title" className="home-hero__wordmark">Cindr3D</h1>
            </div>
            <p className="home-kicker"><Sparkles size={13} /> Open-source · Browser-native · Self-hosted</p>
            <p className="home-hero__lede">
              Design parts, prepare prints, and run a fleet of 3D printers from a single browser workspace.
            </p>
            <div className="home-hero__firmware-chips" aria-label="Supported firmwares">
              <span><Printer size={12} /> Duet / RRF</span>
              <span><Cpu size={12} /> Klipper</span>
              <span><Usb size={12} /> Marlin</span>
              <span><Wifi size={12} /> LAN direct</span>
              <span><Video size={12} /> MJPEG + WebRTC</span>
            </div>
          </div>
          <div className="home-hero__right">
            <div className="home-hero__actions" aria-label="Primary actions">
              <a className="home-button home-button--primary" href="/">
                Open the demo <ChevronRight size={16} />
              </a>
              <a className="home-button home-button--secondary" href="https://github.com/exzile/Cindr3D" target="_blank" rel="noreferrer">
                <GitBranch size={15} /> View on GitHub
              </a>
              <a className="home-button home-button--secondary" href="https://github.com/exzile/Cindr3D/releases/latest" target="_blank" rel="noreferrer">
                Latest release <ExternalLink size={15} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <div className="home-stats-strip" aria-label="At a glance">
        {stats.map((s) => (
          <div className="home-stat" key={s.label}>
            <span className="home-stat__value">{s.value}</span>
            <span className="home-stat__label">{s.label}</span>
            <span className="home-stat__sub">{s.sub}</span>
          </div>
        ))}
      </div>

      {/* Workflows */}
      <section className="home-band home-band--intro" id="workflows" aria-labelledby="workflow-title">
        <div className="home-section-heading">
          <p>Three connected workspaces</p>
          <h2 id="workflow-title">From model to monitored print</h2>
        </div>
        <WorkspaceTabs />
      </section>

      {/* Why Cindr3D */}
      <section className="home-band home-band--why" id="why" aria-labelledby="why-title">
        <div className="home-section-heading">
          <p>Features other tools don't have</p>
          <h2 id="why-title">Why Cindr3D</h2>
        </div>
        <div className="why-grid">
          {whyItems.map((w) => {
            const Icon = w.icon;
            return (
              <article className="why-card" key={w.title} style={{ '--why-color': w.color } as React.CSSProperties}>
                <div className="why-card__icon"><Icon size={20} /></div>
                <div className="why-card__body">
                  <span className="why-card__tag">{w.tag}</span>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Release + Roadmap combined */}
      <ReleaseRoadmapTabs />

      {/* FAQ */}
      <section className="home-band home-band--faq" id="faq" aria-labelledby="faq-title">
        <div className="home-section-heading">
          <p>Common questions</p>
          <h2 id="faq-title">FAQ</h2>
        </div>
        <div className="faq-list">
          {faqs.map((faq) => (
            <details key={faq.q} className="faq-item">
              <summary className="faq-item__question">
                <ChevronRight size={15} className="faq-item__chevron" />
                {faq.q}
              </summary>
              <p className="faq-item__answer">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="home-band home-band--deploy" id="how-to-use" aria-labelledby="deploy-title">
        <div className="deploy-panel">
          <div className="deploy-panel__text">
            <p className="home-kicker"><GitBranch size={15} /> MIT licensed · Self-hosted · No cloud</p>
            <h2 id="deploy-title">Your workshop, your hardware</h2>
            <p>
              Deploy to any static host, NAS, Raspberry Pi, or Orange Pi. Start in the browser with CAD and the slicer — no hardware needed. Connect printers over LAN when you're ready.
            </p>
            <ol className="deploy-steps">
              {useSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
          <div className="deploy-panel__actions">
            <a className="home-button home-button--primary" href="/">
              Launch Cindr3D <Cpu size={18} />
            </a>
            <a className="home-button home-button--light" href="https://github.com/exzile/Cindr3D" target="_blank" rel="noreferrer">
              <GitBranch size={16} /> View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="home-footer">
        <div className="home-footer__inner">
          <div className="home-footer__brand">
            <img src="/logo.png" alt="" />
            <span>Cindr3D</span>
          </div>
          <p className="home-footer__copy">
            MIT licensed · Open source · No telemetry · No cloud
          </p>
          <div className="home-footer__links">
            <a href="https://github.com/exzile/Cindr3D" target="_blank" rel="noreferrer"><GitBranch size={14} /> GitHub</a>
            <a href="https://github.com/exzile/Cindr3D/releases" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Releases</a>
            <a href="https://github.com/exzile/Cindr3D/issues" target="_blank" rel="noreferrer">Issues</a>
            <a href="https://github.com/exzile/Cindr3D/blob/master/LICENSE" target="_blank" rel="noreferrer">License</a>
          </div>
        </div>
      </footer>

      {/* Scroll-to-top */}
      {showScrollTop && (
        <button
          className="scroll-top-btn"
          aria-label="Scroll to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp size={18} />
        </button>
      )}
    </main>
  );
}
