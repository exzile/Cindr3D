import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const sourcePath = path.join(distDir, 'index.html');

const pages = [
  {
    route: '/',
    title: 'Cindr3D | Browser CAD, Slicing, and 3D Printer Control',
    description:
      'Cindr3D is a browser-based CAD, slicing, and printer-control workspace for designing models, preparing prints, and managing 3D printer fleets.',
    ogDescription: 'Browser-based CAD, slicing, and 3D printer control for makers and print farms.',
    heading: 'Browser CAD, slicing, and 3D printer control',
    intro:
      'Cindr3D brings model design, print preparation, G-code inspection, and printer monitoring into one browser workspace.',
    highlights: [
      'Design printable parts with sketch and solid modeling tools.',
      'Prepare prints with slicer profiles, previews, and G-code simulation.',
      'Monitor and control printers from a customizable fleet dashboard.',
    ],
    sections: [
      {
        title: 'One browser workspace for the full print workflow',
        body:
          'Cindr3D combines CAD design, model preparation, G-code inspection, and printer monitoring so makers can move from idea to print without exporting through several disconnected tools.',
      },
      {
        title: 'Built for self-hosted 3D printing',
        body:
          'The app is open source and runs in the browser, with workflows for printable model design, slicing setup, print simulation, and direct printer dashboard control for common firmware environments.',
      },
    ],
    priority: 1,
  },
  {
    route: '/design',
    title: 'Cindr3D Design | Browser-Based CAD for 3D Printing',
    description:
      'Design printable 3D models in the browser with parametric sketches, solid modeling tools, fillets, chamfers, and editable CAD features.',
    ogDescription: 'Parametric browser CAD tools for designing and editing printable 3D models.',
    heading: 'Browser-based CAD for 3D printing',
    intro:
      'Use Cindr3D Design to sketch, extrude, edit, fillet, chamfer, and iterate on printable models without leaving the browser.',
    highlights: [
      'Create parametric sketches with constraints and profile selection.',
      'Build solid features such as extrude, revolve, fillet, and chamfer.',
      'Keep an editable modeling timeline for design changes.',
    ],
    sections: [
      {
        title: 'CAD tools focused on printable parts',
        body:
          'The design workspace provides sketch-driven modeling for practical 3D-print projects, including editable features, profile-based extrude workflows, edge operations, and a compact design timeline.',
      },
      {
        title: 'Model history remains editable',
        body:
          'Cindr3D stores feature metadata for sketches, extrudes, fillets, chamfers, and related model operations so design changes can be reloaded and adjusted instead of flattened into a one-way mesh.',
      },
    ],
    priority: 0.8,
  },
  {
    route: '/prepare',
    title: 'Cindr3D Prepare | Slice, Simulate, and Preview G-code',
    description:
      'Prepare 3D prints with model layout, slicing profiles, G-code preview, layer simulation, breakpoints, and printer-ready export tools.',
    ogDescription: 'Slice, simulate, inspect, and export printer-ready G-code from the browser.',
    heading: 'Slice, simulate, and preview G-code',
    intro:
      'Use Cindr3D Prepare to arrange models, tune printer and filament profiles, inspect toolpaths, and export printer-ready G-code.',
    highlights: [
      'Manage printer, filament, and slicing profiles in one workspace.',
      'Preview layer-by-layer G-code with breakpoints and section views.',
      'Export prepared print files directly from the browser.',
    ],
    sections: [
      {
        title: 'Prepare models before sending them to a printer',
        body:
          'The prepare workspace covers model import, layout, slicing profile management, G-code generation, and print-preview checks before committing material and machine time.',
      },
      {
        title: 'Inspect toolpaths with simulation controls',
        body:
          'Layer preview, G-code sections, breakpoints, and simulation tools help users inspect movement, extrusion, and setup choices before exporting or sending a job to a printer dashboard.',
      },
    ],
    priority: 0.8,
  },
  {
    route: '/printer/dashboard',
    title: 'Cindr3D Printer Dashboard | Manage 3D Printers',
    description:
      'Monitor and control 3D printers with a customizable dashboard for temperatures, motion, macros, cameras, files, and print-farm workflows.',
    ogDescription: 'A customizable browser dashboard for monitoring and controlling 3D printers.',
    heading: 'Manage 3D printers from a browser dashboard',
    intro:
      'Use the Cindr3D printer dashboard to monitor connected machines, arrange dashboard cards, inspect camera feeds, and manage print workflows.',
    highlights: [
      'Track temperatures, motion, files, macros, and printer status.',
      'Customize dashboard layouts per printer.',
      'Connect to common 3D printer firmware and network setups.',
    ],
    sections: [
      {
        title: 'Monitor and control connected 3D printers',
        body:
          'The printer dashboard brings together temperatures, motion controls, files, macros, cameras, print status, and printer-specific panels in one configurable browser interface.',
      },
      {
        title: 'Designed for single printers and small fleets',
        body:
          'Dashboard layouts can be adjusted per printer so users can keep the status cards, camera views, and controls that matter most for their machines and print-farm workflow.',
      },
    ],
    priority: 0.7,
  },
];

const baseUrl = 'https://cindr3d.com';
const imageUrl = `${baseUrl}/logo.png`;
const html = fs.readFileSync(sourcePath, 'utf8');

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function replaceTag(documentHtml, pattern, replacement) {
  return documentHtml.match(pattern)
    ? documentHtml.replace(pattern, replacement)
    : documentHtml.replace('</head>', `    ${replacement}\n  </head>`);
}

function pageSchema(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: page.title.split('|')[0].trim(),
    applicationCategory: 'DesignApplication',
    operatingSystem: 'Web',
    url: `${baseUrl}${page.route}`,
    description: page.description,
    image: imageUrl,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      ...page.highlights,
    ],
  };
}

function staticContent(page) {
  const navLinks = pages
    .map((candidate) => `        <li><a href="${candidate.route}">${escapeHtml(candidate.heading)}</a></li>`)
    .join('\n');
  const highlights = page.highlights
    .map((highlight) => `        <li>${escapeHtml(highlight)}</li>`)
    .join('\n');
  const sections = page.sections
    .map((section) => `      <section>
        <h2>${escapeHtml(section.title)}</h2>
        <p>${escapeHtml(section.body)}</p>
      </section>`)
    .join('\n');

  return `<main class="seo-static-content" aria-label="${escapeHtml(page.heading)}">
      <h1>${escapeHtml(page.heading)}</h1>
      <p>${escapeHtml(page.intro)}</p>
${sections}
      <ul>
${highlights}
      </ul>
      <nav aria-label="Cindr3D sections">
        <h2>Cindr3D sections</h2>
        <ul>
${navLinks}
        </ul>
      </nav>
    </main>`;
}

function withSeo(page) {
  const url = `${baseUrl}${page.route}`;
  let output = html;
  output = replaceTag(output, /<title>.*?<\/title>/s, `<title>${escapeHtml(page.title)}</title>`);
  output = replaceTag(output, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(page.description)}" />`);
  output = replaceTag(output, /<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />');
  output = replaceTag(output, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`);
  output = replaceTag(output, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(page.title)}" />`);
  output = replaceTag(output, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(page.ogDescription)}" />`);
  output = replaceTag(output, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
  output = replaceTag(output, /<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${imageUrl}" />`);
  output = replaceTag(output, /<meta name="twitter:card" content="[^"]*" \/>/, '<meta name="twitter:card" content="summary_large_image" />');
  output = replaceTag(output, /<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`);
  output = replaceTag(output, /<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(page.ogDescription)}" />`);
  output = replaceTag(output, /<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${imageUrl}" />`);
  output = replaceTag(output, /<script type="application\/ld\+json">.*?<\/script>/s, `<script type="application/ld+json">\n      ${JSON.stringify(pageSchema(page), null, 6)}\n    </script>`);
  output = output.replace('<div id="root"></div>', `<div id="root">\n    ${staticContent(page)}\n    </div>`);
  return output;
}

for (const page of pages) {
  const outputPath = page.route === '/'
    ? path.join(distDir, 'index.html')
    : path.join(distDir, page.route.slice(1), 'index.html');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, withSeo(page));
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((page) => `  <url>
    <loc>${baseUrl}${page.route}</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${page.priority.toFixed(1)}</priority>
  </url>`).join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);
