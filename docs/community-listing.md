# Ficha de Figma Community

Borrador para enviar a revisión. Cada bloque va en el campo del mismo nombre del formulario de publicación (Figma Desktop → Plugins → Development → Manage plugins → Publish). Los textos de la ficha están en inglés; las notas, en español.

Requisitos del formulario comprobados el 28-09-2026 en el centro de ayuda de Figma: icono de 128 × 128 px, miniatura de 1920 × 1080 px, hasta 9 imágenes o vídeos en el carrusel, hasta 12 etiquetas, contacto de soporte obligatorio, formulario de seguridad de datos opcional (su revisión tarda hasta dos semanas). Precio en dólares enteros, mínimo 2 $.

## Nombre

```
DoD Lint: design system linter for variables, modes & slots
```

Si en las tarjetas de Community se corta demasiado, la alternativa corta es `DoD Lint: design system linter`.

## Tagline

```
Check components and screens against a Definition of Done, and fix what has a single right answer.
```

## Descripción

```
DoD Lint checks your design system against a Definition of Done: the things every component has to meet before it ships. It reads variables, modes and slots the way Figma resolves them, lists each problem on the layer that has it, and fixes the ones with a single right answer.

What it checks (15 rules)
• Auto layout at every level: frames and groups with several children and no auto layout.
• Padding, gap and radius use tokens and stay on your scale.
• Text styles and resizing: text without a style or typography variables, and fixed boxes that overflow.
• Colors use tokens: literal fills and strokes, with the matching variable when there is one.
• Semantic tokens, not primitives: layers bound straight to a primitive collection.
• Complete states: buttons missing Hover, Pressed, Focus or Disabled, and fields and selection controls missing Hover, Focus or Disabled.
• Variants that don’t overlap: variants stacked on top of each other in a set, where the one below goes unnoticed.
• Minimum touch target: interactive components under 24 px, the WCAG 2.2 AA minimum (configurable).
• Real content, not placeholders: "Label", "Text" or lorem ipsum left as default content.
• Exposed properties: text and swappable icons without component properties.
• Slots defined and respected: slot properties without a layer, slots without auto layout, default content over its limits and, in instances, slots left empty, filled past their limits or with non-preferred content.
• A description on every component, and a documentation link if you ask for one. Icons are left alone.
• No detached instances: frames detached from their component, which no longer get its changes.
• Broken references: missing variables, styles and main components.
• Text contrast (WCAG): components in every mode at once (light and dark, roles, brands), and screens in the mode they have. Each finding says which mode fails.

Built for slots
Content placed in an instance's slots is audited like any other layer, and a slot's default content is checked once, in its component. Figma's own slot limits (minimum, maximum, preferred instances) show up as findings on the slot that breaks them.

Safe fixes
Fixes never invent values. They bind a variable that already has the exact value, from the file or from a library or Figma UI kit it uses, snap to the nearest step of your scale if you allow it, or remove a reference that no longer resolves. Each batch is a single undo step, and you can undo it from the plugin right away. A slot's default content inside an instance is never touched, because editing it would override the whole slot.

Free
Everything is free: selection, page and whole-file audits with all 15 checks, fixes and the Markdown report.

Private by design
DoD Lint runs entirely inside Figma and has no network access. Your language stays in Figma's local plugin storage. The settings and the findings you ignore are saved in the file itself, so the whole team audits with the same Definition of Done.

Languages: the interface is in English and Spanish. Component, state and size names are recognized in English, Spanish, French, German, Portuguese and Italian.

Help, documentation and privacy policy: https://jm-fuster.github.io/dod-lint/
```

Notas:
- La URL de soporte es la página de GitHub Pages. Funciona en cuanto el repositorio sea público y Pages esté activado (ver «Abrir el repositorio» en `docs/desarrollo.md`).
- La ficha solo describe lo que ya hace el build que se envía. La migración a Slots y el informe para MCP del plan se añaden a la ficha cuando existan: la revisión rechaza plugins que no hacen lo que dicen.
- No se menciona Check designs ni ningún otro producto: la política permite rechazar plugins que "recreen funcionalidad de Figma", y compararse con el linter nativo solo llama la atención sobre eso.

## Categoría

`Design tools`

## Etiquetas (12)

```
design system, linter, design tokens, variables, modes, slots, audit, accessibility, contrast, components, consistency, handoff
```

## Detalles finales

- **Contacto de soporte:** https://jm-fuster.github.io/dod-lint/, la página de soporte.
- **Acceso a red:** `None`. Coincide con el manifiesto (`allowedDomains: ["none"]`).
- **Comentarios:** activados. Son la primera vía de feedback y dan señal social a la ficha.
- **Seguridad de datos:** rellenarlo con las respuestas de la sección siguiente. Casi todas son «no», salvo la del almacenamiento: los ajustes y los ignorados se guardan en el archivo, con el almacenamiento de Figma.

## Formulario de seguridad de datos

Es opcional. Figma lo revisa en hasta dos semanas, y mientras tanto el plugin se puede publicar y actualizar. Cuando lo aprueba, la ficha enseña las respuestas a quien tenga la sesión iniciada. Las preguntas son las de «Security disclosure principles», en el centro de ayuda de Figma (comprobadas el 02-10-2026), y las respuestas se han contrastado con el código: el manifiesto, `src/settings.ts` y `src/ignore.ts`.

Respuestas en inglés, para copiar:

**1. Do you host a backend service for your plugin or widget?** → **No**

```
DoD Lint has no backend. It runs entirely inside Figma: the plugin code in Figma's sandbox and the panel in Figma's plugin window.
```

Las preguntas 1b (proceso para vulnerabilidades) y 1c (certificaciones de seguridad) solo se piden con un backend: no aplican.

**2. Does your plugin or widget make network requests with services you don't host?** → **No**

```
DoD Lint makes no network requests. Its manifest declares "networkAccess": { "allowedDomains": ["none"] }, so Figma blocks any request, and the panel loads no external fonts, scripts or images.
```

**3. Does your plugin or widget have user authentication?** → **No**

```
There are no accounts, sign-ins or credentials, and the plugin doesn't read who the user is.
```

La 3b (cómo se protegen las credenciales) no aplica.

**4. Do you store any data read or derived from Figma's plugin or widget API?** → **Sí, solo con el almacenamiento de Figma.** Si el formulario solo deja elegir «Yes» o «No», «Yes» con este texto:

```
Only in the storage Figma provides; nothing leaves Figma.

- In the file's plugin data: the audit settings that differ from the defaults (enabled checks, thresholds, the IDs of the variable collections marked as primitive, traversal options) and the findings a user chose to ignore (check ID, layer ID and the date). They are kept in the file so that everyone who opens it with DoD Lint audits with the same settings, and they are only written when someone saves the settings or ignores or restores a finding.
- In Figma's client storage, on the user's computer: the interface language.

Audits only read the file. Findings and reports stay in the plugin window and are gone when it closes, unless the user copies or downloads the Markdown report.
```

La 4b (cómo y dónde se guarda) y la 4c (quién accede) solo se piden si algo se guarda fuera de Figma. Si aun así salen:

```
4b. In the Figma file's plugin data and in Figma's client storage. Nothing is stored outside Figma.
4c. Anyone who can open the file can see its settings and ignored findings through DoD Lint. The language stays on the user's computer. The developer has no access to any of it.
```

**5. How do you manage updates to your plugin?**

```
The source code is public at https://github.com/jm-fuster/dod-lint, where bugs and questions are tracked as issues. Before each release the code is type-checked, passes an automated suite of more than 200 tests that run every check against a simulated Figma API, and is tried in Figma Desktop. Updates ship only as new versions published to Figma Community. The plugin has no network access and loads no code at run time, so what runs is always the published version. It has no runtime dependencies; the build only uses esbuild and TypeScript.
```

La primera frase da por hecho que el repositorio ya es público. Si el formulario se envía antes, hay que quitarla.

## Precio

Gratis. Decisión del 02-10-2026: todo gratis desde el primer día, sin acceso anticipado ni plan de pago.

- **Por qué:** el plugin es una muestra de los servicios y del contenido propio, no el negocio.
- **Lo que queda abierto:** Figma deja añadir funciones de pago a un plugin publicado gratis, con la Payments API, siempre que conserve las gratuitas ("About selling Community resources", comprobado el 28-09-2026). Lo que ya es gratis tiene que seguir siéndolo: solo se podría cobrar por algo nuevo. El código del pago sigue en el repositorio, inactivo.
- **Lo que se pierde:** el 28-09-2026, «En tendencia» solo mostraba plugins de pago, y favorecía los recién publicados. Los usuarios tendrán que llegar desde el contenido propio.
- **Punto de control:** a los 90 días, con menos de 1.000 usuarios, pasa a mantenimiento.

## Imágenes

Medidas: icono 128 × 128 px; miniatura 1920 × 1080 px. El carrusel admite hasta 9, y bastan 5:

1. **Miniatura:** nombre, promesa ("Design system linter for variables, modes & slots"), las 15 reglas, variables del archivo, sus bibliotecas y los kits de Figma, y "Free", con los resultados y la regla de espaciado abierta.
2. **Slots:** el grupo "Slots defined and respected" abierto, con límites incumplidos y contenido no preferido.
3. **Correcciones:** espaciado y color abiertos, con la llave inglesa y la variable que enlaza, "Fix all" y filas que unen "18 of 36 variants".
4. **Modos:** el contraste en todos los modos de un componente ("in Dark", "also in Brand B · Dark").
5. **Gratis:** todo es gratis, y todo se queda en Figma, con el informe en Markdown.

Rehechas el 02-10-2026 con el panel actual y la marca (`docs/brand.md`).

Las capturas de la UI salen del banco de pruebas (la UI compilada con datos simulados de un "Acme Design System" ficticio), en inglés.

Dónde están:
- **En Figma, editables:** un archivo de borradores, sección "DoD Lint · ficha". Contiene el icono en vectores y las cinco imágenes con texto nativo. Las capturas de la UI van como relleno de imagen, con radio de 24 y sombra. Siguen siendo las del 28-09, con el icono anterior: se rehacen con `build-slide.js` cuando el puente esté abierto en ese archivo, ya con la marca y en Geist (o Inter, si ese Figma no la tiene).
- **En PNG:** `docs/listing/` (`icon.svg`, `icon-128.png` para el formulario, `icon-1024.png` y `slide-1.png` a `slide-5.png`), renderizados desde HTML el 02-10-2026 con la marca. `mark.svg` es la marca con las esquinas redondeadas, para todo lo que no es el icono de Community.
- **Para rehacerlos:** `docs/listing/source/`.

## Playground (opcional)

Un archivo de Community con componentes y pantallas preparados para que se pruebe en un minuto: una Card con slot con límites, instancias que los incumplen, colores literales y un par de contrastes justos. Los fixtures del 28-09 sirven de base.

## Antes de enviar

- [ ] Crear el plugin en Figma (Plugins → Development → New plugin) y copiar su `id` a `manifest.json`.
- [ ] Probar el build en Figma Desktop importando el manifiesto: auditoría, selección de hallazgos, correcciones, Cancelar, redimensionar, informe y los dos idiomas.
- [x] Build de lanzamiento gratuito (01-10-2026): sin el permiso `payments` en el manifiesto, archivo, correcciones e informe quedan desbloqueados, sin la insignia Pro ni los candados, y el pie dice «Gratis, y sin conexión a internet: todo se queda en Figma» (desde el 02-10-2026, al pasar a gratis del todo). El código de pago se conserva, inactivo, y `docs/support.md` no habla de Pro.
- [ ] Compilar con `node scripts/build.mjs --prod`. Comprobado el 02-10-2026 (`code.js` 98 KB, `ui.html` 79 KB, sin avisos de depuración); repetirlo justo antes de enviar, ya con el `id` real.
- [ ] Cuenta: doble factor activado.
- [ ] Página de soporte publicada en https://jm-fuster.github.io/dod-lint/. La publica `.github/workflows/pages.yml`, que la regenera desde `docs/support.md`, en cuanto el repositorio sea público y Pages esté activado: ver «Abrir el repositorio» en `docs/desarrollo.md`. El contacto son los issues del repositorio.
- [x] Miniatura e imágenes del carrusel, rehechas con la UI nueva y la marca (02-10-2026). Icono nuevo: `docs/listing/icon-128.png`.
- [ ] Formulario de seguridad de datos, con las respuestas de [su sección](#formulario-de-seguridad-de-datos).

## Si algún día se añade una función de pago

Solo para algo nuevo: lo que ya es gratis tiene que seguir siéndolo.

- [ ] Stripe conectado y la opción de precio visible en el perfil de Community.
- [ ] Volver a poner el permiso `payments` en el manifiesto (la UI de Pro vuelve sola: ver «Publicar» en `docs/desarrollo.md`) y limitar el muro a la función nueva.
- [ ] Decir en la ficha qué es de pago y en `docs/support.md` que los pagos los procesa Figma, y cambiar la pregunta «Is DoD Lint free?».
