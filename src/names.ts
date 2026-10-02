/**
 * Lo que el plugin reconoce por el nombre: de un componente, de un eje de variantes y de sus valores, de un texto o
 * de una variable. Entiende inglés, español, francés, alemán, portugués e italiano, y compara sin mayúsculas ni
 * acentos (`fold`), así que las listas van sin acentos: «Désactivé» es «desactive», y «Botão», «botao».
 */

/** Sin acentos y sin tocar las mayúsculas, para un patrón: en minúsculas, `\W` pasaría a ser `\w`. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

/** Un nombre sin mayúsculas ni acentos. La ß y las letras de otros alfabetos se quedan como están. */
export function fold(name: string): string {
  return stripAccents(name).toLowerCase();
}

/**
 * Busca palabras enteras en un nombre pasado por `fold`. El `\b` de JavaScript solo conoce las letras ASCII: una
 * palabra que acabara en acento no casaba nunca, ni una japonesa en ningún nombre. Aquí es borde lo que no es una
 * letra latina ni un número, también el guion bajo («btn_primary» es un botón), y en los alfabetos que no separan
 * las palabras basta con que la palabra aparezca.
 */
export function wordsRe(alternatives: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])(?:${alternatives})(?![a-z0-9])`, 'i');
}

/**
 * Nombres de control, por idioma: lo que se pulsa, se escribe o se elige. Es el valor por defecto del ajuste de
 * nombres interactivos. En alemán, las palabras compuestas acaban en lo que son (Eingabefeld, Kippschalter).
 * «Scheda» (italiano) y «Chave» (portugués) se quedan fuera: también son una tarjeta y una llave.
 */
export const INTERACTIVE_PATTERN = [
  'button|btn|fab|input|field|text\\s?area|select|selector|dropdown|combo\\s?box|checkbox|radio|switch|toggle|tab|chip|stepper|segment',
  'boton|campo|casilla|interruptor|conmutador|pestana|desplegable',
  'bouton|champ|saisie|case a cocher|interrupteur|bascule|onglet|selecteur|deroulante?',
  'schaltflache|\\w*knopf|\\w*feld|\\w*eingabe\\w*|\\w*kastchen|\\w*schalter|\\w*reiter|registerkarte|\\w*auswahl\\w*',
  'botao|caixa de (selecao|texto)|aba|seletor',
  'pulsante|bottone|casella|interruttore|selettore|tendina',
].join('|');

/** Lo que se pulsa: si el nombre lo dice, manda aunque diga también otra cosa («Toggle button», «Search button»). */
export const PRESSABLE_NAME = wordsRe('button|btn|fab|chip|tab|boton|pestana|bouton|onglet|schaltflache|\\w*knopf|\\w*reiter|registerkarte|botao|aba|pulsante|bottone');

/** Campos y controles de selección: no se pulsan como un botón, así que no piden Pressed. */
export const FIELD_NAME = wordsRe(
  [
    'input|field|text\\s?area|select|selector|dropdown|combo(box)?|search|checkbox|radio|switch|toggle|stepper',
    'campo|buscador|busqueda|casilla|interruptor|conmutador|desplegable',
    'champ|saisie|recherche|case a cocher|interrupteur|bascule|selecteur|deroulante?',
    '\\w*feld|\\w*eingabe\\w*|suche|\\w*kastchen|\\w*schalter|\\w*auswahl\\w*',
    'caixa de (selecao|texto)|busca|pesquisa|seletor',
    'casella|ricerca|interruttore|selettore|tendina',
  ].join('|'),
);

/** Lo que, al final de un nombre, dice que no es el control sino una parte suya («Button/Label», «Bouton/Icône»). */
export const NOT_A_CONTROL = wordsRe(
  [
    'icon|symbol|badge|tag|link|caption|label|divider',
    'icono|enlace|leyenda|etiqueta|separador',
    'icone|lien|legende|etiquette|libelle|separateur',
    'beschriftung|trenner|trennlinie',
    'rotulo|legenda|divisor',
    'icona|collegamento|didascalia|etichetta|divisore|separatore',
  ].join('|'),
);

/** Nombres del eje de estado. */
export const STATE_AXIS = /^(state|estado|status|etat|statut|zustand|stato)$/;
/** Un eje Status suele ser de negocio (Success, Published…): solo es de estado si tiene alguno de interacción. */
export const BUSINESS_AXIS = /^(status|statut)$/;

/**
 * Nombres de cada estado, también en femenino: en un sistema de pruebas, las pestañas van con Estado=Activa/Inactiva, y
 * «Inactiva» es su reposo, igual que «Inactive». «Activado» y sus parientes no son el reposo de nada: en un
 * interruptor, Activado y Desactivado son encendido y apagado.
 */
export const STATE_SYNONYMS: Record<string, string[]> = {
  default: [
    'default', 'enabled', 'rest', 'resting', 'normal', 'idle', 'inactive',
    'por defecto', 'predeterminado', 'predeterminada', 'reposo', 'habilitado', 'habilitada', 'inactivo', 'inactiva',
    'defaut', 'par defaut', 'repos', 'inactif',
    'standard', 'inaktiv',
    'padrao', 'repouso', 'inativo', 'inativa',
    'predefinito', 'predefinita', 'normale', 'abilitato', 'abilitata', 'riposo', 'inattivo', 'inattiva',
  ],
  hover: ['hover', 'hovered', 'hovering', 'mouseover', 'mouse over', 'survol', 'survole', 'survolee'],
  pressed: [
    'pressed', 'active', 'press', 'clicked',
    'pulsado', 'pulsada', 'presionado', 'presionada', 'clicado', 'clicada',
    'presse', 'pressee', 'appuye', 'appuyee', 'enfonce', 'enfoncee',
    'gedruckt', 'geklickt',
    'pressionado', 'pressionada',
    'premuto', 'premuta', 'cliccato', 'cliccata',
  ],
  focus: [
    'focus', 'focused', 'focus-visible', 'focus visible',
    'foco', 'enfocado', 'enfocada',
    'focalise', 'focalisee',
    'fokus', 'fokussiert',
    'focado', 'focada', 'em foco',
    'focalizzato', 'focalizzata',
  ],
  disabled: [
    'disabled',
    'deshabilitado', 'deshabilitada', 'desactivado', 'desactivada', 'inhabilitado', 'inhabilitada',
    'desactive', 'desactivee',
    'deaktiviert', 'gesperrt',
    'desabilitado', 'desabilitada', 'desativado', 'desativada',
    'disabilitato', 'disabilitata', 'disattivato', 'disattivata',
  ],
  loading: ['loading', 'busy', 'cargando', 'chargement', 'en chargement', 'laden', 'ladt', 'wird geladen', 'carregando', 'caricamento', 'in caricamento'],
  error: ['error', 'invalid', 'invalido', 'invalida', 'erreur', 'invalide', 'fehler', 'ungultig', 'erro', 'errore', 'non valido', 'non valida'],
  selected: ['selected', 'seleccionado', 'seleccionada', 'selectionne', 'selectionnee', 'ausgewahlt', 'selecionado', 'selecionada', 'selezionato', 'selezionata'],
};

/** Los nombres de un estado, en cualquier idioma: «Désactivé» trae los de Disabled. Si no es ninguno conocido, él solo. */
export function synonymsOf(state: string): string[] {
  const key = fold(state.trim());
  return STATE_SYNONYMS[key] ?? Object.values(STATE_SYNONYMS).find((list) => list.includes(key)) ?? [key];
}

/**
 * Valores que solo pueden ser un estado de interacción, por grupo. «Active», «Desactivado» y sus parientes no
 * cuentan: también son estados de negocio (Status=Active/Inactive, Activo/Desactivado, Gesperrt), igual que
 * Success o Error.
 */
const AMBIGUOUS = new Set(['active', 'desactivado', 'desactivada', 'desactive', 'desactivee', 'deaktiviert', 'gesperrt', 'desativado', 'desativada', 'disattivato', 'disattivata']);
const INTERACTION_GROUPS = (['hover', 'pressed', 'focus', 'disabled'] as const).map((g) => new Set(STATE_SYNONYMS[g].filter((s) => !AMBIGUOUS.has(s))));

/** Cuántos estados de interacción distintos (Hover, Pressed, Focus, Disabled) hay entre unos valores ya pasados por `fold`. */
export function interactionStates(options: string[]): number {
  return INTERACTION_GROUPS.filter((group) => options.some((o) => group.has(o))).length;
}

const DISABLED = STATE_SYNONYMS.disabled.join('|');
const TRUE = 'true|yes|on|si|oui|vrai|ja|wahr|sim|vero';
/** Una variante deshabilitada por su nombre: un eje cualquiera con un valor de deshabilitado, o Disabled=True. */
export const DISABLED_VARIANT = new RegExp(`(?:^|,)\\s*[^=,]+=\\s*(?:${DISABLED})(?![a-z0-9])|(?:^|[,\\s])(?:${DISABLED})\\s*=\\s*(?:${TRUE})(?![a-z0-9])`);
/** Un valor de variante, o el nombre de una propiedad booleana, que dice deshabilitado («Is disabled», «Disabled hover»). */
export const DISABLED_WORD = new RegExp(DISABLED);

/** Variantes de tamaño pequeño, a las que basta el mínimo de WCAG AA aunque se pida más. */
export const SMALL_SIZE = new RegExp(
  '(?:size|tamano|tamanho|taille|groe?(?:ss|ß)e|dimensione|taglia)\\s*=\\s*' +
    '(?:x*s|sm|small|compact|dense|mini|tiny|pequen[oa]|compact[oa]|dens[oa]|petite?|compacte|klein|kompakt|piccol[oa]|compatt[oa])(?![a-z0-9])',
);

/**
 * Contenido genérico de un texto de componente. «TODO» no está: en español, «Todo» es un filtro de verdad; como
 * marca de algo pendiente se escribe en mayúsculas (ver `isPlaceholder`).
 */
const PLACEHOLDERS = new Set([
  'text', 'label', 'button', 'title', 'heading', 'subtitle', 'body', 'caption', 'placeholder', 'description', 'link', 'item', 'value', 'name',
  'texto', 'etiqueta', 'boton', 'titulo', 'encabezado', 'subtitulo', 'cuerpo', 'leyenda', 'descripcion', 'enlace', 'elemento', 'valor', 'nombre',
  'texte', 'libelle', 'etiquette', 'bouton', 'titre', 'sous-titre', 'legende', 'lien', 'element', 'valeur', 'nom',
  'beschriftung', 'schaltflache', 'titel', 'uberschrift', 'untertitel', 'beschreibung', 'wert',
  'rotulo', 'botao', 'corpo', 'legenda', 'descricao', 'nome',
  'testo', 'etichetta', 'pulsante', 'bottone', 'titolo', 'sottotitolo', 'didascalia', 'descrizione', 'collegamento', 'valore',
  'lorem', 'lorem ipsum', 'tbd', 'xxx',
]);

export function isPlaceholder(text: string): boolean {
  const t = text.trim();
  return PLACEHOLDERS.has(fold(t)) || t === 'TODO';
}

/** Iconos, ilustraciones, logos y mapas: varias formas sueltas en un frame pequeño no son un problema de layout. */
export const ART_NAME = wordsRe('icon|icono|icone|icona|glyph|symbol|illustration|ilustracion|ilustracao|illustrazione|logo|logotipo|canvas|lienzo|map|mapa|mappa');

/** Una instancia de icono (dentro de un nombre, como en «Leading icon» o «Icône gauche»). */
export const ICON_LAYER = /icon|glyph|symbol/;

/** Glifos estructurales, cuya visibilidad ya la gobierna la variante (check, chevron, caret…). */
export const STRUCTURAL_GLYPH = wordsRe(
  [
    'check|chevron|caret|arrow|close|clear|indicator|dot|handle',
    'flecha|cerrar|indicador|punto',
    'fleche|fermer|coche|indicateur|poignee',
    'pfeil|schliessen|haken|indikator|punkt|griff',
    'seta|fechar|ponto',
    'freccia|chiudi|spunta|indicatore|maniglia',
  ].join('|'),
);

/** Colecciones con nombre de primitiva. */
export const PRIMITIVE_NAME = /primitiv|^0?1\b|\bcore\b|\bbase\b|\bbasis\b|\bkern\b|\bnucleo\b|\bnoyau\b|palette|paleta|tavolozza|raw|global/;

export type FloatKind = 'spacing' | 'radius';

/** Nombres de variable de espaciado y de radio. */
export const KIND_NAME: Record<FloatKind, RegExp> = {
  spacing: /space|spacing|gap|padding|inset|espac|margin|marge|gutter|abstand|spazi/,
  radius: /radius|radio|corner|round|esquina|rayon|arrondi|raio|raggio|arredond|arrotond|rundung/,
};

const NOT_SIZE =
  'font|fuente|police|schrift|caratter|tipo|typo|text|testo|letter|letra|lettre|paragraph|parrafo|paragrafo|absatz|opac|deckkraft|' +
  'weight|peso|graisse|gewicht|durat|durac|duree|dauer|z-?index|elevation|elevac|elevaz|icon|stroke|trazo|tratto|line|linha|ligne|linie|zeile';
/** Nombres que nunca son espaciado ni radio aunque la variable no restrinja ámbitos. Un borde puede tener radio. */
export const NON_SPATIAL: Record<FloatKind, RegExp> = {
  spacing: new RegExp(`${NOT_SIZE}|border|borde|bordure|borda|bordo|rahmen`),
  radius: new RegExp(NOT_SIZE),
};
