import {
  Boxes,
  BrainCircuit,
  Camera,
  ChevronRight,
  Cloud,
  Cpu,
  ExternalLink,
  Layers3,
  MonitorDot,
  Printer,
  Route,
  Sparkles,
} from 'lucide-react';
import './HomePage.css';

const workflows = [
  {
    title: 'Design',
    copy: 'Sketch parts, build parametric features, organize components, and export models from a browser-based CAD workspace.',
    image: '/help/help-design-overview.png',
  },
  {
    title: 'Prepare',
    copy: 'Arrange parts on the plate, tune print profiles, inspect sliced toolpaths, and generate labeled G-code for object cancellation.',
    image: '/help/help-prepare-workspace.png',
  },
  {
    title: 'Print',
    copy: 'Connect printers, monitor jobs, manage files, queue work across a fleet, and control firmware-specific features from one panel.',
    image: '/help/help-printer-workspace.png',
  },
];

const featureGroups = [
  {
    icon: Boxes,
    title: 'CAD workspace',
    items: ['Sketch and solid tools', 'Feature timeline', 'Component tree', 'STEP, STL, OBJ, and project export'],
  },
  {
    icon: Layers3,
    title: 'Slicer and preview',
    items: ['Plate layout', 'WASM slicing kernels', 'G-code preview', 'Calibration utilities'],
  },
  {
    icon: Printer,
    title: 'Printer control',
    items: ['Duet/RRF, Klipper, and Marlin workflows', 'Files, macros, console, power, spools', 'Object cancellation and live progress'],
  },
  {
    icon: Camera,
    title: 'Print farm intelligence',
    items: ['Smart queue routing', 'Fleet cameras and PTZ', 'Layer galleries', 'Cross-printer comparisons'],
  },
  {
    icon: BrainCircuit,
    title: 'AI-ready tooling',
    items: ['Local MCP bridge', 'In-app assistant panel', 'CAD, slicer, and printer tools exposed to agents'],
  },
  {
    icon: Cloud,
    title: 'Demo hosting',
    items: ['Static Azure deployment', 'Manual publish workflow', 'Release ZIP for self-hosted updates'],
  },
];

const useSteps = [
  'Open the app and start in Design to sketch, import, or edit a part.',
  'Switch to Prepare to arrange the plate, slice, and inspect the generated toolpath.',
  'Move to 3D Printer to connect hardware, queue jobs, monitor cameras, and manage print-farm work.',
  'Use the Help button inside the app for guided screenshots and firmware-specific setup notes.',
];

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__media" aria-hidden="true" />
        <nav className="home-nav" aria-label="Demo navigation">
          <a className="home-nav__brand" href="/home">
            <img src="/logo.png" alt="" />
            <span>Cindr3D</span>
          </a>
          <div className="home-nav__links">
            <a href="#workflows">Workflows</a>
            <a href="#features">Features</a>
            <a href="#how-to-use">How to use</a>
            <a href="/">Open app</a>
          </div>
        </nav>
        <div className="home-hero__content">
          <p className="home-kicker"><Sparkles size={16} /> Browser CAD, slicing, and print-farm control</p>
          <h1 id="home-hero-title">Cindr3D</h1>
          <p className="home-hero__lede">
            A self-hostable workshop system for designing parts, preparing prints, and running multiple 3D printers from one browser workspace.
          </p>
          <div className="home-hero__actions" aria-label="Primary actions">
            <a className="home-button home-button--primary" href="/">
              Open the demo <ChevronRight size={18} />
            </a>
            <a className="home-button home-button--secondary" href="https://github.com/exzile/Cindr3D/releases/latest">
              Latest release <ExternalLink size={18} />
            </a>
          </div>
        </div>
      </section>

      <section className="home-band home-band--intro" id="workflows" aria-labelledby="workflow-title">
        <div className="home-section-heading">
          <p>Three connected workspaces</p>
          <h2 id="workflow-title">From model to monitored print</h2>
        </div>
        <div className="workflow-grid">
          {workflows.map((workflow) => (
            <article className="workflow-card" key={workflow.title}>
              <img src={workflow.image} alt={`${workflow.title} workspace screenshot`} />
              <div>
                <h3>{workflow.title}</h3>
                <p>{workflow.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-band home-band--features" id="features" aria-labelledby="feature-title">
        <div className="home-section-heading">
          <p>What the system does</p>
          <h2 id="feature-title">A workshop operating surface</h2>
        </div>
        <div className="feature-grid">
          {featureGroups.map((feature) => {
            const Icon = feature.icon;
            return (
              <article className="feature-card" key={feature.title}>
                <Icon size={22} />
                <h3>{feature.title}</h3>
                <ul>
                  {feature.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section className="home-band home-band--how" id="how-to-use" aria-labelledby="how-title">
        <div className="home-section-heading">
          <p>How to use the demo</p>
          <h2 id="how-title">Start simple, then connect hardware</h2>
        </div>
        <div className="how-layout">
          <ol className="how-steps">
            {useSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div className="home-callout">
            <MonitorDot size={28} />
            <h3>Azure demo notes</h3>
            <p>
              The hosted site is static, so CAD, slicer preview, docs, and UI exploration work immediately. Printer control features need browser access to your local printer, serial device, or LAN camera.
            </p>
          </div>
        </div>
      </section>

      <section className="home-band home-band--deploy" aria-labelledby="deploy-title">
        <div className="deploy-panel">
          <div>
            <p className="home-kicker"><Route size={16} /> Ready for demos</p>
            <h2 id="deploy-title">Publish when you choose</h2>
            <p>
              The Azure Static Web Apps workflow stays manual-only. Run the GitHub Actions workflow when you want to refresh the public demo.
            </p>
          </div>
          <a className="home-button home-button--primary" href="/">
            Launch Cindr3D <Cpu size={18} />
          </a>
        </div>
      </section>
    </main>
  );
}
