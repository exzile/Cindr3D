import {
  Accessibility,
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ArrowUp,
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  Box,
  BrainCircuit,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Code2,
  Copy,
  Cpu,
  Crosshair,
  DollarSign,
  Download,
  Droplets,
  ExternalLink,
  Eye,
  Film,
  FlaskConical,
  FolderOpen,
  Gauge,
  GitBranch,
  GitMerge,
  Globe,
  History,
  Image,
  Images,
  LayoutGrid,
  Layers3,
  ListChecks,
  ListOrdered,
  Menu,
  MessageSquare,
  Microscope,
  Monitor,
  Move,
  Navigation,
  Package,
  Palette,
  PenLine,
  PieChart,
  Play,
  Printer,
  Receipt,
  RefreshCw,
  Rocket,
  RotateCcw,
  Route,
  Ruler,
  Scan,
  Scissors,
  Server,
  Shapes,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  SwitchCamera,
  Tablet,
  Tag,
  Terminal,
  Thermometer,
  Timer,
  TreePine,
  Upload,
  Usb,
  Video,
  Wand2,
  Wifi,
  Wind,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import './HomePage.css';
import { faqs, stats, useSteps, whyItems } from './homeContent';
import { FeatureDirectory } from './FeatureDirectory';
import { ReleaseRoadmapTabs } from './ReleaseRoadmapTabs';
import { WorkspaceTabs } from './WorkspaceTabs';


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
    { href: '#features', label: 'Features' },
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
          <p>Connected pages and workspaces</p>
          <h2 id="workflow-title">From model to monitored print</h2>
        </div>
        <WorkspaceTabs />
      </section>

      <FeatureDirectory />

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
