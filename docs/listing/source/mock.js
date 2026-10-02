// Datos simulados para ver la UI de DoD Lint fuera de Figma (revisión y capturas de la ficha).
// Parámetros: ?lang=en|es&view=main|results|settings|report|done&pay=FREE|UNPAID|PAID&open=slots,color
(() => {
  const q = new URLSearchParams(location.search);
  const lang = q.get('lang') === 'es' ? 'es' : 'en';
  const view = q.get('view') || 'results';
  // Por defecto, sin pago: como el plugin publicado, que es gratis.
  const pay = q.get('pay') || 'FREE';
  const open = (q.get('open') || '').split(',').filter(Boolean);
  const checks = __dodlint.checks;

  const settings = {
    enabled: Object.fromEntries(checks.map((c) => [c.id, true])),
    language: lang,
    primitiveAuto: true,
    primitiveCollectionIds: [],
    touchMin: 24,
    includeHidden: false,
    includeInstanceInternals: false,
    includeTopLevelFrames: false,
    spacingComponentsOnly: false,
    ignorePrefixes: ['_', '.'],
    snapToScale: false,
    requiredStates: ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'],
    fieldStates: ['Default', 'Hover', 'Focus', 'Disabled'],
    interactivePattern:
      'button|btn|fab|input|field|text\\s?area|select|selector|dropdown|combo\\s?box|checkbox|radio|switch|toggle|tab|chip|stepper|segment|boton|campo|casilla|interruptor|conmutador|pestana|desplegable|bouton|champ|saisie|case a cocher|interrupteur|bascule|onglet|selecteur|deroulante?|schaltflache|\\w*knopf|\\w*feld|\\w*eingabe\\w*|\\w*kastchen|\\w*schalter|\\w*reiter|registerkarte|\\w*auswahl\\w*|botao|caixa de (selecao|texto)|aba|seletor|pulsante|bottone|casella|interruttore|selettore|tendina',
    minDescriptionLength: 20,
    requireDocLinks: false,
  };

  let seq = 0;
  /** Un hallazgo. `extra`: fix, fixTo (lo que enseña la llave inglesa), variantOf, overridden. */
  const F = (checkId, nodeName, nodeType, path, severity, en, es, extra = {}) => {
    const nodeId = '1:' + ++seq;
    return { checkId, nodeId, nodeName, nodeType, path, pageId: '0:1', pageName: 'Components', message: lang === 'es' ? es : en, severity, ignoreKey: `${checkId}|${nodeId}`, ...extra };
  };
  /** El mismo hallazgo en `n` variantes de un set de `of`: el panel lo une en una fila («18 of 36 variants»). */
  const V = (n, of, set, layerPath, checkId, nodeName, nodeType, severity, en, es, extra = {}) =>
    Array.from({ length: n }, (_, i) =>
      F(checkId, nodeName, nodeType, `${set} / Variant ${i + 1}${layerPath ? ' / ' + layerPath : ''}`, severity, en, es, {
        ...extra,
        variantOf: { setId: 'set:' + set, setName: set, variantId: 'v:' + set + i, variants: of, layerPath },
      }),
    );
  const bindColor = (target = 'fills') => ({ kind: 'bind-color', target, index: 0, variableId: 'VariableID:1:1' });
  const bindFloat = (field) => ({ kind: 'bind-float', field, fields: [field], variableId: 'VariableID:1:2' });

  const findings = [
    // Tokens: lo escrito a mano que vale lo mismo que una variable se corrige con la llave inglesa.
    ...V(18, 36, 'Button', 'Label', 'color', 'Label', 'TEXT', 'error', 'Fill #1A1A1A is hard-coded (matches color/text/primary)', 'Relleno #1A1A1A sin token (coincide con color/text/primary)', { fix: bindColor(), fixTo: 'text/primary' }),
    F('color', 'Container', 'FRAME', 'Card / Variant=Elevated', 'error', 'Stroke #E6E6E6 is hard-coded (matches color/border/default)', 'Trazo #E6E6E6 sin token (coincide con color/border/default)', { fix: bindColor('strokes'), fixTo: 'border/default' }),
    F('color', 'Badge', 'INSTANCE', 'Checkout / Order summary', 'error', 'Fill #FFE8CC is hard-coded (instance override)', 'Relleno #FFE8CC sin token (override en instancia)', { overridden: true }),
    ...V(12, 24, 'Input', '', 'spacing', 'Input', 'COMPONENT', 'warning', 'Padding 16 is hard-coded (matches space/4)', 'Padding 16 sin token (existe space/4)', { fix: bindFloat('paddingLeft'), fixTo: 'space/4' }),
    F('spacing', 'Actions', 'FRAME', 'Card / Variant=Elevated', 'warning', 'Gap 8 is hard-coded (matches space/2)', 'Gap 8 sin token (existe space/2)', { fix: bindFloat('itemSpacing'), fixTo: 'space/2' }),
    F('spacing', 'Chip', 'COMPONENT', 'Chip / Size=md', 'warning', 'Radius 100 is hard-coded: it’s already a pill (matches radius/full)', 'Radio 100 sin token: ya es una píldora (existe radius/full)', { fix: bindFloat('cornerRadius'), fixTo: '999 · radius/full' }),
    F('spacing', 'Variant=Elevated', 'COMPONENT', 'Card', 'error', 'Padding 10 is off the scale (nearest step: 12, space/3)', 'Padding 10 fuera de escala (paso más cercano: 12, space/3)'),
    F('text', 'Price', 'TEXT', 'Checkout / Order summary / Card / Content', 'warning', 'Text without a text style or typography variables (Inter Semi Bold 16)', 'Texto sin estilo de texto ni variables tipográficas (Inter Semi Bold 16)'),
    // Contraste: dentro de un componente, en cada modo del que dependen sus colores.
    F('contrast', 'Label', 'TEXT', 'Tag / Tone=Brand', 'error', 'Contrast 2.91:1 in Dark, minimum 4.5:1 for 14 px text on Tag (#2A2A3A) (also in Brand B · Dark)', 'Contraste 2.91:1 en Oscuro, mínimo 4.5:1 para 14 px sobre Tag (#2A2A3A) (también en Marca B · Oscuro)'),
    F('contrast', 'Helper text', 'TEXT', 'Input / State=Default', 'warning', 'Contrast 3.92:1 in Light, minimum 4.5:1 for 12 px text on Field (#FFFFFF)', 'Contraste 3.92:1 en Claro, mínimo 4.5:1 para 12 px sobre Field (#FFFFFF)'),
    F('contrast', 'Caption', 'TEXT', 'Card / Variant=Outlined', 'warning', 'Contrast 4.12:1 in Brand B · Light, minimum 4.5:1 for 12 px text on Card (#F4F1FA)', 'Contraste 4.12:1 en Marca B · Claro, mínimo 4.5:1 para 12 px sobre Card (#F4F1FA)'),
    // Componentes y slots.
    F('states', 'Button', 'COMPONENT_SET', '', 'warning', 'Missing states in State: Focus', 'Faltan estados en State: Focus'),
    F('touch', 'Chip', 'COMPONENT_SET', '', 'warning', '1 of 6 variants below 24 px (smallest: 64 × 20 px)', '1 de 6 variantes por debajo de 24 px (la más pequeña, 64 × 20 px)'),
    F('slots', 'Content', 'SLOT', 'Checkout / Order summary / Card', 'warning', 'Slot "Content" has 4 items: it takes at most 2', 'Slot "Content" con 4 elementos: admite como máximo 2'),
    F('slots', 'Content', 'SLOT', 'Checkout / Order summary / Card', 'warning', 'Slot "Content" has content outside its preferred instances: "Promo banner"', 'Slot "Content" con contenido fuera de sus instancias preferidas: "Promo banner"'),
    F('slots', 'Actions', 'SLOT', 'Checkout / Header', 'warning', 'Slot "Actions" is empty: it needs at least 1 item', 'Slot "Actions" vacío: pide al menos 1 elemento'),
    F('slots', 'Actions', 'SLOT', 'Toolbar / Size=md', 'warning', 'Slot "Actions" has no auto layout: inserted content won’t arrange itself (in 2 of 2 variants)', 'Slot "Actions" sin auto layout: lo que se inserte no se ordena solo (en 2 de 2 variantes)'),
    F('slots', 'Card', 'COMPONENT_SET', '', 'info', 'Slot "Content" has no description: explain what content it takes', 'Slot "Content" sin descripción: explica qué contenido admite'),
    F('description', 'Toolbar', 'COMPONENT_SET', '', 'warning', 'No description', 'Sin descripción'),
    F('detached', 'Header', 'FRAME', 'Checkout', 'warning', 'Detached from "Top bar": it no longer gets the component’s changes', 'Desvinculado de «Top bar»: ya no recibe los cambios del componente'),
    F('broken', 'Icon', 'INSTANCE', 'Card / Variant=Outlined', 'error', 'Main component deleted (it can be restored from the instance)', 'Componente principal eliminado (restaurable desde la instancia)'),
  ];

  const send = (msg) => window.postMessage({ pluginMessage: msg }, '*');
  send({
    type: 'ready',
    fileName: 'Acme Design System',
    payment: { type: pay, trialDaysLeft: null },
    collections: [
      { id: 'c1', name: 'Primitives', hidden: true, colorCount: 64, floatCount: 18, modeNames: ['Value'], isPrimitive: true },
      { id: 'c2', name: 'Semantic', hidden: false, colorCount: 42, floatCount: 0, modeNames: ['Light', 'Dark'], isPrimitive: false },
      { id: 'c3', name: 'Scale', hidden: false, colorCount: 0, floatCount: 24, modeNames: ['Value'], isPrimitive: false, library: 'Acme Core' },
    ],
    settings,
    selectionCount: 3,
    checks,
    dev: false,
  });
  if (view === 'results' || view === 'report') {
    send({ type: 'results', findings, scope: 'page', scanned: 1284, pages: 1, durationMs: 1400, truncated: [], skippedContrast: 3, untokenized: {} });
  }
  // Sin hallazgos: el veredicto «Cumple la Definición de hecho».
  if (view === 'done') send({ type: 'results', findings: [], scope: 'page', scanned: 1284, pages: 1, durationMs: 1400, truncated: [], skippedContrast: 0, untokenized: {} });
  setTimeout(() => {
    for (const id of open) {
      const head = document.querySelector(`[data-action="toggle-group"][data-id="${id}"]`);
      const expanded = head && head.getAttribute('aria-expanded') === 'true';
      if (head && !expanded) head.click();
    }
    if (view === 'settings') document.querySelector('[data-action="view"][data-view="settings"]')?.click();
    if (view === 'report') document.querySelector('[data-action="view"][data-view="report"]')?.click();
    // `focus` sube el grupo, con su categoría si la abre, hasta debajo de la cabecera fija. El hueco del final deja
    // subir también el último grupo, que si no se quedaba a medias con una fila cortada arriba.
    const focus = q.get('focus');
    const head = focus && document.querySelector(`[data-action="toggle-group"][data-id="${focus}"]`);
    if (head) {
      const group = head.closest('.group');
      const prev = group.previousElementSibling;
      const target = prev && prev.classList.contains('cat') ? prev : group;
      const body = document.querySelector('.body');
      body.insertAdjacentHTML('beforeend', `<div style="height:${body.clientHeight}px"></div>`);
      target.style.scrollMarginTop = `${document.querySelector('.filters')?.offsetHeight ?? 0}px`;
      target.scrollIntoView({ block: 'start' });
    }
    document.body.dataset.ready = '1';
  }, 50);
})();
