import {
  ArrowUp,
  ChevronRight,
  Cpu,
  ExternalLink,
  GitBranch,
  Menu,
  Printer,
  Sparkles,
  Usb,
  Video,
  Wifi,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './HomePage.css';
import { faqs, stats, useSteps, whyItems } from './homeContent';
import { FeatureDirectory } from './FeatureDirectory';
import { ReleaseRoadmapTabs } from './ReleaseRoadmapTabs';
import { WorkspaceTabs } from './WorkspaceTabs';

function DotRibbonField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    let clockSeconds = 0;
    let lastTimestamp = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let animationId = 0;
    let running = false;
    let pausedForFocus = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const shapePoints = (cx: number, cy: number, radius: number, phase: number) => {
      const points: Array<[number, number]> = [];
      const sides = 3 + (Math.floor(phase / 160) % 4);
      const rotation = phase * 0.012;
      for (let i = 0; i <= sides; i += 1) {
        const angle = rotation + (Math.PI * 2 * i) / sides;
        const wobble = 1 + Math.sin(phase * 0.02 + i * 1.7) * 0.12;
        points.push([
          cx + Math.cos(angle) * radius * wobble,
          cy + Math.sin(angle) * radius * wobble,
        ]);
      }
      return points;
    };

    const drawDot = (x: number, y: number, radius: number, color: string, alpha: number) => {
      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    };

    const drawDottedShape = (points: Array<[number, number]>, alpha: number, color: string, phase: number) => {
      for (let index = 0; index < points.length - 1; index += 1) {
        const [x1, y1] = points[index];
        const [x2, y2] = points[index + 1];
        const distance = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(4, Math.floor(distance / 11));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const pulse = 0.72 + Math.sin(phase * 0.06 + index + step * 0.5) * 0.28;
          drawDot(
            x1 + (x2 - x1) * t,
            y1 + (y2 - y1) * t,
            1.05 + pulse * 0.55,
            color,
            alpha * pulse,
          );
        }
      }
    };

    const render = () => {
      context.clearRect(0, 0, width, height);

      const time = clockSeconds * 0.72;
      const phase = clockSeconds * 60;
      const count = Math.max(48, Math.floor(width / 18));
      const rows = 9;
      const cx = width * 0.63;
      const cy = height * 0.47;
      const ribbonWidth = Math.min(width * 0.5, 660);

      context.globalCompositeOperation = 'source-over';

      for (let row = 0; row < rows; row += 1) {
        const rowT = (row - (rows - 1) / 2) / rows;
        const offset = rowT * 120;
        const color = row % 3 === 0 ? '#f06c3f' : row % 3 === 1 ? '#73d2de' : '#fffaf0';
        for (let i = 0; i < count; i += 1) {
          const p = i / (count - 1);
          const x = cx - ribbonWidth / 2 + p * ribbonWidth;
          const wave = Math.sin(p * Math.PI * 2.2 + time * 2.3 + row * 0.42);
          const fold = Math.sin(p * Math.PI * 5.4 - time * 1.6 + row * 0.7);
          const twist = Math.cos(p * Math.PI * 3.2 + time + row);
          const y = cy + wave * (height * 0.12) + fold * 18 + offset + twist * rowT * 58;
          const depth = 1 - Math.abs(rowT);
          const pulse = 0.74 + Math.sin(time * 4 + i * 0.37 + row) * 0.26;
          drawDot(
            x,
            y,
            (0.9 + depth * 1.25) * pulse,
            color,
            (0.22 + depth * 0.22) * pulse,
          );
        }
      }

      for (let i = 0; i < 22; i += 1) {
        const p = (i / 22 + time * 0.055) % 1;
        const x = cx - ribbonWidth / 2 + p * ribbonWidth;
        const y = cy + Math.sin(p * Math.PI * 4.8 + time * 2) * (height * 0.15);
        const size = 32 + Math.sin(time * 3 + i) * 10;
        const points = shapePoints(x, y, size, phase + i * 19);
        drawDottedShape(points, 0.09 + (i % 5 === 0 ? 0.15 : 0), i % 2 ? '#73d2de' : '#f06c3f', phase + i);
      }

      const focalPoints = [
        shapePoints(width * 0.78, height * 0.32, 84, phase),
        shapePoints(width * 0.52, height * 0.68, 58, phase + 60),
      ];
      focalPoints.forEach((points, index) => drawDottedShape(points, index === 0 ? 0.34 : 0.22, index === 0 ? '#fffaf0' : '#73d2de', phase + index * 30));
    };

    const tick = (timestamp: number) => {
      if (!running) return;
      if (lastTimestamp === 0) lastTimestamp = timestamp;
      const deltaSeconds = Math.max(0, (timestamp - lastTimestamp) / 1000);
      clockSeconds += Math.min(deltaSeconds, 1 / 30);
      lastTimestamp = timestamp;
      render();
      animationId = requestAnimationFrame(tick);
    };

    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const canRun = () => !motionQuery?.matches && !document.hidden && !pausedForFocus;

    const stopAnimation = () => {
      running = false;
      lastTimestamp = 0;
      cancelAnimationFrame(animationId);
    };

    const startAnimation = () => {
      if (!canRun()) {
        stopAnimation();
        render();
        return;
      }
      if (running) return;
      running = true;
      lastTimestamp = 0;
      cancelAnimationFrame(animationId);
      animationId = requestAnimationFrame(tick);
    };

    const handleLifecycleChange = () => {
      startAnimation();
    };

    const handleBlur = () => {
      pausedForFocus = true;
      stopAnimation();
    };

    const handleFocus = () => {
      pausedForFocus = false;
      startAnimation();
    };

    resize();
    render();
    startAnimation();
    window.addEventListener('resize', resize);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleLifecycleChange);
    motionQuery?.addEventListener('change', handleLifecycleChange);

    return () => {
      stopAnimation();
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleLifecycleChange);
      motionQuery?.removeEventListener('change', handleLifecycleChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="home-hero__dot-field" aria-hidden="true" />;
}

const HOME_NAV_LINKS = [
  { href: '#workflows', label: 'Workflows' },
  { href: '#features', label: 'Features' },
  { href: '#why', label: 'Why Cindr3D' },
  { href: '#v2', label: 'Release' },
  { href: '#faq', label: 'FAQ' },
  { href: '#how-to-use', label: 'Get started' },
];

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const navIds = HOME_NAV_LINKS.map((link) => link.href.slice(1));
    let frame = 0;

    const updateActiveSection = () => {
      frame = 0;
      const navBottom = document.querySelector('.home-nav')?.getBoundingClientRect().bottom ?? 52;
      const dockLine = navBottom + 6;

      let activeId = navIds[0];

      navIds.forEach((id) => {
        const section = document.getElementById(id);
        if (!section) return;

        const panel = section.classList.contains('home-band')
          ? section.querySelector<HTMLElement>('.home-panel') ?? section
          : section;
        const panelRect = panel.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const isDocked = panelRect.top <= dockLine && sectionRect.bottom > navBottom;

        if (isDocked) {
          activeId = id;
        }
      });

      setActiveSection((current) => (current === activeId ? current : activeId));
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    window.addEventListener('hashchange', requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      window.removeEventListener('hashchange', requestUpdate);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <main className="home-page">
      <nav className="home-nav" aria-label="Site navigation">
        <a className="home-nav__brand" href="/">
          <img src="/logo.png" alt="" />
          <span>Cindr3D</span>
        </a>
        <div className={`home-nav__links${menuOpen ? ' home-nav__links--open' : ''}`}>
          {HOME_NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={activeSection === l.href.slice(1) ? 'home-nav__link--active' : ''}
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <a href="/design" className="home-button home-button--primary home-nav__cta" style={{ minHeight: 32, padding: '0 14px', fontSize: 13 }}>
            Launch Cindr3D
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
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__stage">
          <div className="home-hero__media" aria-hidden="true">
            <DotRibbonField />
          </div>
          <div className="home-hero__content">
          <div className="home-hero__left">
            <div className="home-hero__brand">
              <img src="/logo.png" alt="" className="home-hero__logo" aria-hidden="true" />
              <h1 id="home-hero-title" className="home-hero__wordmark">Cindr3D</h1>
            </div>
            <p className="home-kicker"><Sparkles size={13} /> Free 3D CAD | Browser-native | Self-hosted</p>
            <p className="home-hero__lede">
              Design parts in free browser CAD, slice prints, and run a fleet of 3D printers from a single workspace.
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
              <a className="home-button home-button--primary" href="/design">
                Launch Cindr3D <ChevronRight size={16} />
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
          <div className="home-stats-strip" aria-label="At a glance">
            {stats.map((s) => (
              <div className="home-stat" key={s.label}>
                <span className="home-stat__value">{s.value}</span>
                <span className="home-stat__label">{s.label}</span>
                <span className="home-stat__sub">{s.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflows */}
      <section className="home-band home-band--intro" id="workflows" aria-labelledby="workflow-title">
        <div className="home-panel">
          <div className="home-section-heading">
            <p>Connected pages and workspaces</p>
            <h2 id="workflow-title">From model to monitored print</h2>
          </div>
          <WorkspaceTabs />
        </div>
      </section>

      <FeatureDirectory />

      {/* Why Cindr3D */}
      <section className="home-band home-band--why" id="why" aria-labelledby="why-title">
        <div className="home-panel">
          <div className="home-section-heading">
            <p>Features other tools don't have</p>
            <h2 id="why-title">Why Cindr3D</h2>
          </div>
          <div className="why-showcase">
          <div className="why-proof">
            <span>One workspace</span>
            <strong>CAD, slicing, printer control, and AI execution live together instead of being passed between separate apps.</strong>
          </div>
          <div className="why-showcase__left">
            <div className="why-showcase__visual" aria-hidden="true">
              <div className="why-orbit">
                <span>Design</span>
                <span>Slicer</span>
                <span>Print</span>
              </div>
              <div className="why-device why-device--design">
                <img src="/help/help-design-overview.png" alt="" />
              </div>
              <div className="why-device why-device--slicer">
                <img src="/help/help-prepare-overview.png" alt="" />
              </div>
              <div className="why-device why-device--print">
                <img src="/help/help-printer-fleet.png" alt="" />
              </div>
              <div className="why-signal why-signal--one" />
              <div className="why-signal why-signal--two" />
            </div>
          </div>
          <div className="why-showcase__content">
            <div className="why-list">
              {whyItems.map((w, index) => {
                const Icon = w.icon;
                return (
                  <article
                    className="why-card"
                    key={w.title}
                    style={{ '--why-color': w.color, '--why-delay': `${index * 70}ms` } as React.CSSProperties}
                  >
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
          </div>
          </div>
        </div>
      </section>

      {/* Release + FAQ */}
      <section className="home-band home-band--release home-band--release-faq" id="v2" aria-labelledby="release-title">
        <div className="home-panel home-panel--release-faq">
          <ReleaseRoadmapTabs />
          <div className="release-faq" id="faq" aria-labelledby="faq-title">
            <div className="home-section-heading">
              <p>Common questions</p>
              <h2 id="faq-title">FAQ</h2>
            </div>
            <div className="faq-list">
              {faqs.map((faq) => (
                <article key={faq.q} className="faq-item faq-item--static">
                  <div className="faq-item__question">
                    <ChevronRight size={15} className="faq-item__chevron" />
                    {faq.q}
                  </div>
                  <p className="faq-item__answer">{faq.a}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="home-band home-band--deploy" id="how-to-use" aria-labelledby="deploy-title">
        <div className="home-panel">
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
          <div className="deploy-panel__visual" aria-hidden="true">
            <div className="deploy-orbit deploy-orbit--outer" />
            <div className="deploy-orbit deploy-orbit--inner" />
            <div className="deploy-core">
              <img src="/logo.png" alt="" />
              <span>Cindr3D</span>
            </div>
            <div className="deploy-node deploy-node--host">
              <Sparkles size={17} />
              <span>Static host</span>
            </div>
            <div className="deploy-node deploy-node--printer">
              <Printer size={17} />
              <span>LAN printer</span>
            </div>
            <div className="deploy-node deploy-node--camera">
              <Video size={17} />
              <span>Camera feed</span>
            </div>
            <div className="deploy-node deploy-node--usb">
              <Usb size={17} />
              <span>USB fallback</span>
            </div>
            <div className="deploy-signal deploy-signal--one" />
            <div className="deploy-signal deploy-signal--two" />
            <div className="deploy-signal deploy-signal--three" />
          </div>
          <div className="deploy-panel__actions">
            <a className="home-button home-button--primary" href="/design">
              Launch Cindr3D <Cpu size={18} />
            </a>
            <a className="home-button home-button--light" href="https://github.com/exzile/Cindr3D" target="_blank" rel="noreferrer">
              <GitBranch size={16} /> View on GitHub
            </a>
          </div>
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
