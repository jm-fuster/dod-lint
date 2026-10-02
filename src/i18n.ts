// Textos en dos idiomas. Cada cadena lleva sus dos versiones juntas, en el sitio donde se usa:
// el tipo obliga a escribir las dos, así que ningún mensaje se queda sin traducir.

export type Lang = 'en' | 'es';

/** Ajuste de idioma: automático sigue el idioma del sistema (navigator.language de la UI). */
export type LanguageSetting = 'auto' | Lang;

export interface Text {
  en: string;
  es: string;
}

/** Idioma efectivo. En automático y sin idioma del sistema conocido (el sandbox no tiene navigator), inglés. */
export function resolveLang(setting: string | undefined, locale?: string | null): Lang {
  if (setting === 'en' || setting === 'es') return setting;
  return locale && /^es\b/i.test(locale) ? 'es' : 'en';
}
