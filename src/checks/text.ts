import type { Check } from './index';
import type { Finding } from '../types';
import { OVERRIDE_NOTE, propertyName } from '../context';
import { isPlaceholder } from '../names';

/** Campos que definen la tipografía: si una instancia sobrescribe alguno en un texto, su estilo se decide ahí. */
const TYPE_FIELDS = ['textStyleId', 'fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent', 'textCase', 'textDecoration', 'leadingTrim'];
/** Campos que deciden si la caja de texto crece con el contenido. */
const BOX_FIELDS = ['textAutoResize', 'textTruncation'];

/** El texto usa estilos o variables tipográficas y no vive en cajas fijas sin truncado. */
export const textCheck: Check = {
  meta: {
    id: 'text',
    category: 'text',
    title: { es: 'Texto con estilo y tamaño correcto', en: 'Text styles and resizing' },
    description: {
      es: 'Textos sin estilo de texto ni variables tipográficas, y cajas de tamaño fijo sin truncado, que desbordan si cambia el contenido. En las instancias, solo si cambian la tipografía o la caja.',
      en: 'Text without a text style or typography variables, and fixed-size text boxes without truncation, which overflow when the content changes. On instances, only if they change the typography or the box.',
    },
    severity: 'warning',
    fixable: false,
  },
  overrides: [...TYPE_FIELDS, ...BOX_FIELDS],
  run(node, ctx, page) {
    if (node.type !== 'TEXT' || ctx.isCanvasLabel(node)) return null;
    const out: Finding[] = [];
    // Un texto de instancia hereda del componente: cada parte cuenta si la instancia sobrescribe lo suyo.
    const own = ctx.overridesOf(node);
    const suffix = own ? ctx.tx(OVERRIDE_NOTE) : '';
    const bound = ctx.prop<Record<string, unknown> | undefined>(node, 'boundVariables') ?? {};
    const typographyBound = ['fontSize', 'fontFamily', 'fontStyle', 'fontWeight', 'lineHeight'].some((f) => bound[f]);

    if (!own || TYPE_FIELDS.some((f) => own.has(f))) {
      const textStyleId = ctx.prop<string | symbol>(node, 'textStyleId');
      if (typeof textStyleId === 'symbol') {
        const segments = node.getStyledTextSegments(['textStyleId']);
        const unstyled = segments.filter((s) => !s.textStyleId).length;
        if (unstyled && !typographyBound) {
          out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `${unstyled} segmento(s) de texto sin estilo${suffix}`, en: `${unstyled} text segment(s) without a style${suffix}` })));
        }
      } else if (!textStyleId && !typographyBound) {
        const size = node.fontSize === figma.mixed ? node.getRangeFontSize(0, 1) : node.fontSize;
        const fam = node.fontName === figma.mixed ? node.getRangeFontName(0, 1) : node.fontName;
        const desc = typeof fam === 'object' ? `${fam.family} ${fam.style} ${typeof size === 'number' ? size : ''}` : '';
        const detail = desc ? ` (${desc.trim()})` : '';
        out.push(
          ctx.finding(node, page, this.meta, ctx.tx({ es: `Texto sin estilo de texto ni variables tipográficas${detail}${suffix}`, en: `Text without a text style or typography variables${detail}${suffix}` })),
        );
      }
    }

    if ((!own || BOX_FIELDS.some((f) => own.has(f))) && node.textAutoResize === 'NONE' && node.textTruncation === 'DISABLED') {
      const message = ctx.tx({ es: `Caja de texto de tamaño fijo sin truncado: el contenido puede desbordar${suffix}`, en: `Fixed-size text box without truncation: the content can overflow${suffix}` });
      out.push(ctx.finding(node, page, this.meta, message, { severity: 'info' }));
    }
    return out.length ? out : null;
  },
};

/** Texto real de la app como contenido por defecto. */
export const placeholderCheck: Check = {
  meta: {
    id: 'placeholder',
    category: 'text',
    title: { es: 'Contenido real, no de relleno', en: 'Real content, not placeholders' },
    description: {
      es: 'Textos de componentes con un contenido genérico (Text, Label, Button…) o vacíos, y lorem ipsum en cualquier sitio. Si es el valor por defecto de una propiedad de texto, sale como información.',
      en: 'Component text with generic content (Text, Label, Button…) or none, and lorem ipsum anywhere. If it’s the default value of a text property, it’s listed as info.',
    },
    severity: 'warning',
    fixable: false,
  },
  overrides: ['characters'],
  run(node, ctx, page) {
    if (node.type !== 'TEXT' || ctx.isCanvasLabel(node)) return null;
    // El contenido de un texto de instancia es el del componente, salvo que la instancia lo cambie.
    const own = ctx.overridesOf(node);
    if (own && !own.has('characters')) return null;
    const suffix = own ? ctx.tx(OVERRIDE_NOTE) : '';
    const raw = ctx.prop<string>(node, 'characters');
    const t = raw.trim().toLowerCase();
    const shown = raw.trim().length > 40 ? raw.trim().slice(0, 40) + '…' : raw.trim();
    // El valor por defecto de una propiedad de texto lo cambia cada instancia: en Simple Design System eran 197
    // de 199 («Label», «Button», «Value»). Se informa; sin propiedad, el relleno se queda en cada instancia.
    const inside = ctx.insideComponent(node);
    const refs = !own && inside ? ctx.prop<{ characters?: string } | null | undefined>(node, 'componentPropertyReferences') : undefined;
    const prop = refs?.characters ? propertyName(refs.characters) : '';
    const filler = () =>
      prop
        ? ctx.finding(node, page, this.meta, ctx.tx({ es: `Contenido de relleno: "${shown}" (valor por defecto de la propiedad ${prop})`, en: `Placeholder content: "${shown}" (default value of the ${prop} property)` }), { severity: 'info' })
        : ctx.finding(node, page, this.meta, ctx.tx({ es: `Contenido de relleno: "${shown}"${suffix}`, en: `Placeholder content: "${shown}"${suffix}` }));
    if (t.startsWith('lorem ipsum')) return [filler()];
    // El punto 7 habla del contenido por defecto de los componentes; fuera de ellos un "Button" puede ser un título legítimo.
    if (!inside) return null;
    if (!t) return [ctx.finding(node, page, this.meta, ctx.tx({ es: `Texto vacío${suffix}`, en: `Empty text${suffix}` }), { severity: 'info' })];
    if (isPlaceholder(raw)) return [filler()];
    return null;
  },
};
