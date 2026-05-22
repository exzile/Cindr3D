import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const sourcePath = path.join(distDir, 'index.html');

const pages = [
  {
    route: '/home',
    title: 'Cindr3D | Browser CAD, Slicing, and 3D Printer Control',
    description:
      'Cindr3D is a browser-based CAD, slicing, and printer-control workspace for designing models, preparing prints, and managing 3D printer fleets.',
    ogDescription: 'Browser-based CAD, slicing, and 3D printer control for makers and print farms.',
    priority: 1,
  },
  {
    route: '/design',
    title: 'Cindr3D Design | Browser-Based CAD for 3D Printing',
    description:
      'Design printable 3D models in the browser with parametric sketches, solid modeling tools, fillets, chamfers, and editable CAD features.',
    ogDescription: 'Parametric browser CAD tools for designing and editing printable 3D models.',
    priority: 0.8,
  },
  {
    route: '/prepare',
    title: 'Cindr3D Prepare | Slice, Simulate, and Preview G-code',
    description:
      'Prepare 3D prints with model layout, slicing profiles, G-code preview, layer simulation, breakpoints, and printer-ready export tools.',
    ogDescription: 'Slice, simulate, inspect, and export printer-ready G-code from the browser.',
    priority: 0.8,
  },
  {
    route: '/printer/dashboard',
    title: 'Cindr3D Printer Dashboard | Manage 3D Printers',
    description:
      'Monitor and control 3D printers with a customizable dashboard for temperatures, motion, macros, cameras, files, and print-farm workflows.',
    ogDescription: 'A customizable browser dashboard for monitoring and controlling 3D printers.',
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
      'Browser-based CAD modeling',
      '3D print preparation and slicing',
      'G-code preview and simulation',
      '3D printer dashboard and fleet monitoring',
    ],
  };
}

function withSeo(page) {
  const url = `${baseUrl}${page.route}`;
  let output = html;
  output = replaceTag(output, /<title>.*?<\/title>/s, `<title>${escapeHtml(page.title)}</title>`);
  output = replaceTag(output, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(page.description)}" />`);
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
  return output;
}

for (const page of pages) {
  const directory = path.join(distDir, page.route.slice(1));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), withSeo(page));
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
