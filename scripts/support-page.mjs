// Página de soporte con la marca (docs/brand.md), generada a partir de docs/support.md.
// Uso: node scripts/support-page.mjs → docs/site/index.html. La publica en GitHub Pages .github/workflows/pages.yml, que antes
// la vuelve a generar.
// El Markdown que entiende es el que usa support.md: títulos, párrafos, listas con un nivel anidado, tablas,
// negrita, código y enlaces. Un párrafo que empieza con una línea toda en negrita es una pregunta de las FAQ.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(root, 'docs/site');
const md = readFileSync(resolve(root, 'docs/support.md'), 'utf8').replace(/\r\n/g, '\n');
const lines = md.split('\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

/** Lo de dentro de una línea. El código se aparta antes, para que un `**` dentro de él no se convierta. */
function inline(text) {
  const code = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${code[n]}</code>`);
}

const item = (line) => /^( *)([-*]|\d+\.) +/.exec(line);
const isTable = (line) => /^\|.*\|\s*$/.test(line);
let i = 0;

/** Una lista desde la línea `i`; un elemento más sangrado abre una lista dentro del anterior. */
function list(indent) {
  const tag = /\d/.test(item(lines[i])[2]) ? 'ol' : 'ul';
  const items = [];
  for (let m; i < lines.length && (m = item(lines[i])) && m[1].length >= indent; ) {
    if (m[1].length > indent && items.length) items[items.length - 1] += list(m[1].length);
    else items.push(inline(lines[i++].slice(m[0].length)));
  }
  return `<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`;
}

let title = '';
const intro = [];
const body = [];
const toc = [];
while (i < lines.length) {
  const line = lines[i];
  const out = toc.length ? body : intro;
  let m;
  if (!line.trim()) {
    i++;
  } else if ((m = /^(#{1,3}) +(.*)$/.exec(line))) {
    const text = m[2].trim();
    i++;
    if (m[1].length === 1) {
      title = text;
      continue;
    }
    if (m[1].length === 2) toc.push([slug(text), text]);
    (toc.length ? body : intro).push(`<h${m[1].length} id="${slug(text)}">${inline(text)}</h${m[1].length}>`);
  } else if (isTable(line)) {
    const rows = [];
    while (i < lines.length && isTable(lines[i])) rows.push(lines[i++]);
    const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const [head, , ...rest] = rows;
    out.push(
      `<div class="table"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
    );
  } else if (item(line)) {
    out.push(list(item(line)[1].length));
  } else {
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#|^\|/.test(lines[i]) && !item(lines[i])) para.push(lines[i++]);
    if (para.length > 1 && /^\*\*[^*]+\*\*$/.test(para[0])) {
      const q = para.shift().slice(2, -2);
      out.push(`<h3 id="${slug(q)}">${inline(q)}</h3>`);
    }
    out.push(`<p>${para.map(inline).join(' ')}</p>`);
  }
}

// La marca: el mismo dibujo que docs/listing/mark.svg.
const mark = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1c1f26"/><g stroke-width="9" stroke-linecap="round"><path d="M15.34 34.14 21 39.8" stroke="#d4ff3f"/><path d="M33 39.8 48.56 24.24" stroke="#eef0f4"/></g></svg>`;
const favicon = `data:image/svg+xml,${encodeURIComponent(mark(64).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace('#1c1f26', '#111318'))}`;

// Geist y Geist Mono (OFL) van con la página si están en docs/site/fonts; si no, la página usa las del sistema.
const fonts = [
  ['Geist', 'fonts/Geist-Variable.woff2'],
  ['Geist Mono', 'fonts/GeistMono-Variable.woff2'],
].filter(([, file]) => existsSync(resolve(site, file)));
const fontFaces = fonts.map(([family, file]) => `@font-face { font-family: '${family}'; src: url('${file}') format('woff2'); font-weight: 100 900; font-display: swap; }`).join('\n      ');

const [product, page] = title.includes(' · ') ? title.split(' · ') : ['DoD Lint', title];
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${intro.find((b) => b.startsWith('<p>'))?.replace(/<[^>]+>/g, '') ?? ''}" />
    <link rel="icon" href="${favicon}" />
    <style>
      ${fontFaces}
      /* Generada con scripts/support-page.mjs a partir de docs/support.md: los cambios, allí. */
      :root {
        --ink: #111318; --tile: #1c1f26; --mist: #eef0f4; --slate: #8a90a2; --lime: #d4ff3f;
        --bg: #ffffff; --text: var(--ink); --muted: #555b69; --line: #e3e5ea; --surface: #f4f5f7; --link: var(--ink);
        --sans: Geist, Inter, -apple-system, 'Segoe UI', system-ui, sans-serif;
        --mono: 'Geist Mono', ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace;
      }
      @media (prefers-color-scheme: dark) {
        :root { --bg: var(--ink); --text: var(--mist); --muted: #a3a9b8; --line: #2a2e37; --surface: var(--tile); --link: var(--lime); }
      }
      * { box-sizing: border-box; }
      html { -webkit-text-size-adjust: 100%; }
      body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
      .wrap { max-width: 760px; margin: 0 auto; padding: 0 16px; }
      header { background-color: var(--ink); background-image: radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px); background-size: 20px 20px; color: var(--mist); border-bottom: 1px solid #2a2e37; }
      .brand { display: inline-flex; align-items: center; gap: 10px; padding: 20px 0 0; color: var(--mist); text-decoration: none; font-weight: 700; font-size: 18px; letter-spacing: -0.02em; }
      .brand svg { display: block; }
      .mono { font-family: var(--mono); font-weight: 500; color: var(--lime); }
      .hero { padding: 40px 0 28px; }
      h1 { font-size: clamp(34px, 7vw, 48px); line-height: 1.05; letter-spacing: -0.035em; margin: 0 0 14px; text-wrap: balance; }
      .lead { color: #a3a9b8; font-size: 18px; margin: 0; max-width: 640px; text-wrap: pretty; }
      nav { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 0 22px; }
      nav a { color: var(--mist); text-decoration: none; font-size: 14px; padding: 4px 10px; border-radius: 999px; background: rgba(255, 255, 255, 0.06); }
      nav a:hover, nav a:focus-visible { background: var(--lime); color: var(--ink); }
      main { padding: 8px 16px 48px; }
      h2 { font-size: 26px; line-height: 1.2; letter-spacing: -0.02em; margin: 48px 0 12px; display: flex; align-items: center; gap: 10px; }
      h2::before { content: ''; flex: none; width: 10px; height: 10px; border-radius: 3px; background: var(--lime); box-shadow: 0 0 0 1px rgba(17, 19, 24, 0.12); }
      h3 { font-size: 17px; line-height: 1.35; margin: 28px 0 4px; }
      p { margin: 0 0 14px; text-wrap: pretty; }
      a { color: var(--link); text-decoration-color: var(--slate); text-underline-offset: 3px; }
      a:hover { text-decoration-color: currentColor; }
      main a:focus-visible, .brand:focus-visible { outline: 2px solid var(--lime); outline-offset: 2px; border-radius: 3px; }
      code { font-family: var(--mono); font-size: 0.88em; background: var(--surface); border: 1px solid var(--line); padding: 0 5px; border-radius: 5px; }
      ul, ol { margin: 0 0 16px; padding-left: 22px; }
      li { margin: 4px 0; }
      li > ul { margin: 4px 0 0; }
      ul > li::marker { color: var(--slate); }
      ol { list-style: none; padding: 0; counter-reset: step; }
      ol > li { counter-increment: step; position: relative; padding-left: 40px; margin: 10px 0; }
      ol > li::before { content: counter(step); position: absolute; left: 0; top: 1px; width: 26px; height: 26px; border-radius: 7px; background: var(--ink); color: var(--lime); font: 500 13px/26px var(--mono); text-align: center; box-shadow: 0 0 0 1px #2a2e37; }
      .table { overflow-x: auto; margin: 0 0 16px; border: 1px solid var(--line); border-radius: 10px; }
      table { border-collapse: collapse; width: 100%; font-size: 15px; }
      th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-top: 1px solid var(--line); }
      thead th { border-top: 0; background: var(--surface); font-weight: 600; }
      td:first-child { font-weight: 600; min-width: 150px; }
      footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
      footer .wrap { display: flex; align-items: center; gap: 10px; padding: 20px 16px 32px; }
    </style>
  </head>
  <body>
    <header>
      <div class="wrap">
        <a class="brand" href="#">${mark(32)}<span>DoD <span class="mono">lint</span></span></a>
        <div class="hero">
          <h1>${inline(page)}</h1>
          ${intro.map((b) => b.replace(/^<p>/, '<p class="lead">')).join('\n          ')}
        </div>
        <nav aria-label="Contents">${toc.map(([id, text]) => `<a href="#${id}">${inline(text)}</a>`).join('')}</nav>
      </div>
    </header>
    <main class="wrap">
      ${body.join('\n      ')}
    </main>
    <footer>
      <div class="wrap">${mark(20)}<span>${esc(product)} · Free · Nothing leaves Figma</span></div>
    </footer>
  </body>
</html>
`;

mkdirSync(site, { recursive: true });
writeFileSync(resolve(site, 'index.html'), html, 'utf8');
console.log(`Listo: docs/site/index.html (${toc.length} secciones${fonts.length ? `, con ${fonts.map(([f]) => f).join(' y ')}` : ', con las fuentes del sistema'})`);
if (md.includes('ISSUES_URL')) console.warn('Aviso: docs/support.md aún tiene ISSUES_URL sin rellenar (el enlace de Contacto).');
