// Monta en Figma un borrador editable de la ficha de DoD Lint. Se ejecuta con new Function('figma', 'SLIDE', …).
// SLIDE = 0 monta el icono; 1-5, cada imagen. Idempotente: rehace la pieza si ya existe.
// La clave del archivo de destino, para no escribir en otro por error: ponla antes de usarlo.
const FILE_KEY = 'CLAVE_DEL_ARCHIVO';
if (figma.fileKey !== FILE_KEY) return { ABORTADO: true, archivo: figma.root.name };
const page = figma.root.children[0];
if (figma.currentPage.id !== page.id) await figma.setCurrentPageAsync(page);
// Geist y Geist Mono, como la ficha (docs/brand.md). Si este Figma no las tiene, Inter. «Semi Bold» se llama
// «SemiBold» en algunas familias.
const available = await figma.listAvailableFontsAsync();
const styleIn = (family, style) => [style, style.replace(' ', '')].find((s) => available.some((a) => a.fontName.family === family && a.fontName.style === s));
const SANS = ['Regular', 'Medium', 'Semi Bold', 'Bold'].every((s) => styleIn('Geist', s)) ? 'Geist' : 'Inter';
const MONO = styleIn('Geist Mono', 'Medium') ? 'Geist Mono' : SANS;
const font = (family, style) => ({ family, style: styleIn(family, style) || style });
await Promise.all([...['Regular', 'Medium', 'Semi Bold', 'Bold'].map((s) => font(SANS, s)), font(MONO, 'Medium')].map((f) => figma.loadFontAsync(f)));

const C = { ink: '#111318', text: '#EEF0F4', muted: '#A3A9B8', slate: '#8A90A2', lime: '#D4FF3F', white: '#FFFFFF' };
// La marca (docs/listing/mark.svg), delante de cada antetítulo.
const MARK = '<svg width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1C1F26"/><path d="M15.34 34.14 L21 39.8" stroke="#D4FF3F" stroke-width="9" stroke-linecap="round"/><path d="M33 39.8 L48.56 24.24" stroke="#EEF0F4" stroke-width="9" stroke-linecap="round"/></svg>';
const rgb = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const solid = (h, opacity = 1) => ({ type: 'SOLID', color: rgb(h), opacity });
const hashes = {};
const imageHash = async (file) => {
  if (!hashes[file]) hashes[file] = figma.createImage(new Uint8Array(await (await fetch(`http://localhost:9231/${file}?${Date.now()}`).then((r) => r.arrayBuffer())))).hash;
  return hashes[file];
};

let section = page.findOne((n) => n.type === 'SECTION' && n.name === 'DoD Lint · ficha');
if (!section) {
  section = figma.createSection();
  section.name = 'DoD Lint · ficha';
  page.appendChild(section);
  section.x = 0;
  section.y = 0;
}

const text = (parent, chars, o) => {
  const t = figma.createText();
  t.fontName = font(SANS, o.style || 'Regular');
  t.fontSize = o.size;
  t.characters = chars;
  t.fills = [solid(o.color || C.text)];
  if (o.lh) t.lineHeight = { unit: 'PERCENT', value: o.lh };
  if (o.ls) t.letterSpacing = { unit: 'PERCENT', value: o.ls };
  if (o.upper) t.textCase = 'UPPER';
  parent.appendChild(t);
  if (o.width) {
    t.textAutoResize = 'HEIGHT';
    t.resize(o.width, t.height);
  }
  if (o.name) t.name = o.name;
  return t;
};
const autoFrame = (parent, name, dir, gap, o = {}) => {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = dir;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.itemSpacing = gap;
  f.fills = o.fills || [];
  f.clipsContent = false;
  if (o.pad) [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft] = o.pad;
  if (o.align) f.counterAxisAlignItems = o.align;
  parent.appendChild(f);
  return f;
};
const bullets = (parent, items, size, width) => {
  const list = autoFrame(parent, 'bullets', 'VERTICAL', 24);
  for (const [dot, chars] of items) {
    const row = autoFrame(list, 'bullet', 'HORIZONTAL', 20, { align: 'MIN' });
    const holder = autoFrame(row, 'dot', 'VERTICAL', 0, { pad: [Math.round(size * 0.38), 0, 0, 0] });
    const e = figma.createEllipse();
    e.resize(16, 16);
    e.fills = [solid(dot)];
    holder.appendChild(e);
    text(row, chars, { size, lh: 130, width: width - 36 });
  }
  return list;
};

const SPECS = {
  1: { title: 'Miniatura', shot: 'results-overview.png', kicker: 'Figma plugin', h1: 'DoD lint', sub: 'Design system linter for variables, modes & slots',
       items: [[C.lime, '15 checks against your Definition of Done'], [C.lime, 'Variables from the file, its libraries and Figma’s UI kits'], [C.lime, 'Safe fixes that bind the token you already have']], pill: true },
  2: { title: 'Slots', shot: 'results-slots.png', kicker: 'Slots', h2: 'Slots, audited both ways',
       items: [[C.lime, 'In components: slot properties with no layer, slots without auto layout, default content over its limits.'], [C.lime, 'In instances: slots left empty, overfilled or with content outside the preferred instances.'], [C.lime, 'Content placed in a slot is checked like any other layer. Default content is checked once, in its component.']] },
  3: { title: 'Correcciones', shot: 'results-fix.png', kicker: 'Safe fixes', h2: 'Fixes with a single right answer',
       items: [[C.lime, 'Binds the variable that already has the exact value, from the file or a library it uses.'], [C.lime, 'The same finding in 18 variants is one row and one fix.'], [C.lime, 'Removes references that no longer resolve.'], [C.slate, 'Each batch is a single undo step, and you can undo it from the plugin.']] },
  4: { title: 'Modos', shot: 'results-contrast.png', kicker: 'Variables & modes', h2: 'Every mode in one audit',
       lead: 'Inside components, text contrast is checked in every mode its colors depend on: light and dark, roles, brands. The finding says which mode fails. Screens are checked in the mode they have.' },
  5: { title: 'Gratis', shot: 'report.png', kicker: 'Free', h2: 'Everything is free',
       items: [[C.lime, 'Selection, page and whole-file audits'], [C.lime, 'All 15 checks and their fixes'], [C.lime, 'The Markdown report, to copy or download'], [C.slate, 'No network access: nothing leaves Figma']] },
};

if (SLIDE === 0) {
  const old = section.findOne((n) => n.name === 'Icono · 128');
  if (old) old.remove();
  const svg = await (await fetch(`http://localhost:9231/icon.svg?${Date.now()}`)).text();
  const icon = figma.createNodeFromSvg(svg);
  icon.rescale(128 / icon.width);
  icon.name = 'Icono · 128';
  section.appendChild(icon);
  icon.x = 200;
  icon.y = 200;
  return { icon: icon.id, section: section.id };
}

const spec = SPECS[SLIDE];
const name = `${SLIDE} · ${spec.title}`;
const old = section.findOne((n) => n.type === 'FRAME' && n.name === name);
if (old) old.remove();
const f = figma.createFrame();
f.name = name;
section.appendChild(f);
f.resize(1920, 1080);
f.x = 200;
f.y = 520 + (SLIDE - 1) * (1080 + 160);
f.clipsContent = true;
f.fills = [solid(C.ink), { type: 'IMAGE', imageHash: await imageHash('bg.png'), scaleMode: 'FILL' }];

// Columna de texto, colocada a mano y centrada en vertical.
const blocks = [];
const kicker = autoFrame(f, 'kicker', 'HORIZONTAL', 14, { align: 'CENTER' });
const mark = figma.createNodeFromSvg(MARK);
mark.rescale(40 / 64);
mark.name = 'mark';
kicker.appendChild(mark);
text(kicker, spec.kicker, { size: 26, style: 'Medium', color: C.muted, ls: 12, upper: true });
blocks.push([kicker, 28]);
if (spec.h1) {
  // «lint» en Geist Mono y lima, como el logotipo.
  const title = text(f, spec.h1, { size: 128, style: 'Bold', lh: 100, ls: -3.5, width: 960, name: 'title' });
  const at = spec.h1.indexOf('lint');
  title.setRangeFontName(at, at + 4, font(MONO, 'Medium'));
  title.setRangeFills(at, at + 4, [solid(C.lime)]);
  blocks.push([title, 30]);
}
if (spec.h2) blocks.push([text(f, spec.h2, { size: 84, style: 'Bold', lh: 104, ls: -3, width: 980, name: 'title' }), 36]);
if (spec.sub) blocks.push([text(f, spec.sub, { size: 44, color: C.muted, lh: 122, width: 1010, name: 'subtitle' }), 56]);
if (spec.lead) blocks.push([text(f, spec.lead, { size: 36, color: C.muted, lh: 138, width: 960, name: 'lead' }), 0]);
if (spec.items) blocks.push([bullets(f, spec.items, 34, 960), 60]);
if (spec.pill) {
  const pill = autoFrame(f, 'pill', 'HORIZONTAL', 10, { align: 'CENTER', pad: [14, 26, 14, 26], fills: [solid(C.lime)] });
  pill.cornerRadius = 999;
  text(pill, 'Free · Nothing leaves Figma', { size: 28, style: 'Semi Bold', color: C.ink });
  blocks.push([pill, 0]);
}
const total = blocks.reduce((sum, [node, gap], i) => sum + node.height + (i < blocks.length - 1 ? gap : 0), 0);
let y = Math.round((1080 - total) / 2);
for (const [node, gap] of blocks) {
  node.x = 150;
  node.y = y;
  y += node.height + gap;
}

// Captura de la UI a la derecha.
const shot = figma.createRectangle();
shot.name = `UI · ${spec.shot}`;
f.appendChild(shot);
shot.resize(560, 891);
shot.x = 1210;
shot.y = Math.round((1080 - 891) / 2);
shot.cornerRadius = 24;
shot.fills = [{ type: 'IMAGE', imageHash: await imageHash(spec.shot), scaleMode: 'FILL' }];
shot.strokes = [solid(C.white, 0.1)];
shot.strokeAlign = 'INSIDE';
shot.strokeWeight = 1;
shot.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.6 }, offset: { x: 0, y: 40 }, radius: 120, spread: 0, visible: true, blendMode: 'NORMAL' }];
return { slide: SLIDE, frame: f.id, blocks: blocks.length, textHeight: total };
