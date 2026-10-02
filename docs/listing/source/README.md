# Fuentes de las imágenes de la ficha y del README

Con esto se rehacen las capturas de la UI, las imágenes de la ficha y las del README cuando cambie la interfaz.

| Archivo | Para qué |
|---|---|
| `mock.js` | Datos simulados de un "Acme Design System" ficticio. Parámetros: `lang=en\|es`, `view=main\|results\|settings\|report\|done` (`done`: sin hallazgos, con el veredicto), `pay=FREE\|UNPAID\|PAID` (FREE por defecto, como el lanzamiento gratuito), `open=<ids de regla>`, `focus=<id>` |
| `frame.html` | Mete la UI en un iframe de 440 × 700 con `zoom: 2`. Chrome sin interfaz no admite ventanas tan estrechas y, sin él, la captura sale cortada. |
| `listing.html` | Las cinco imágenes de 1920 × 1080 (`?slide=1…5`), con la marca (`docs/brand.md`). Carga Geist de Google Fonts, así que para renderizarlas hace falta conexión. |
| `bg.html`, `icon.html` | Fondo de puntos, e icono a 1024 px o al tamaño de `?size=` (128 para el formulario) |
| `build-slide.js` | Monta en Figma el borrador editable (`SLIDE` 0 = icono, 1-5 = imágenes). Su guarda pide la clave del archivo de destino (`FILE_KEY`, arriba del todo): ponla antes de usarlo. |
| `banner.html` | Banner de los README (`docs/readme/en/banner.png` y `docs/readme/es/banner.png`, con `?lang=en` o `?lang=es`): 1280 × 640, renderizado al doble. Se abre desde el repositorio, porque usa las fuentes de `docs/site/fonts`. |
| `shot.html` | Enmarca una captura del panel para el README (`?img=<captura>`): esquinas redondeadas, borde fino y sombra, sobre fondo transparente |
| `serve.mjs` | Servidor local en `127.0.0.1:9231` para todo lo anterior |

Pasos:

1. `npm run build`.
2. En una carpeta de trabajo, generar `harness.html` a partir de `dist/ui.html`, añadiendo antes de `</body>` `<script src="standalone.js"></script><script src="mock.js"></script>`. Copiar al lado `dist/standalone.js` y estos archivos.
3. `node serve.mjs <carpeta> 9231`.
4. Capturas de la UI (880 × 1400, el doble del tamaño real), con Chrome sin interfaz y un perfil propio para no chocar con el Chrome abierto:
   `chrome --headless=new --hide-scrollbars --user-data-dir=<carpeta>/chrome-profile --window-size=880,1400 --virtual-time-budget=5000 --screenshot=<nombre>.png "http://127.0.0.1:9231/frame.html?lang=en&<parámetros>"`

   | Captura | Parámetros | Imagen |
   |---|---|---|
   | `results-overview.png` | `view=results` (la regla de espaciado sale abierta) | 1 |
   | `results-slots.png` | `view=results&open=slots&focus=slots` | 2 |
   | `results-fix.png` | `view=results&open=color` | 3 |
   | `results-contrast.png` | `view=results&open=contrast&focus=contrast` | 4 |
   | `report.png` | `view=report` | 5 |

   `focus` sube el grupo, con su categoría, hasta justo debajo de la cabecera fija, también si es el último. Las capturas de la ficha son de antes de este cambio, que se notaría al rehacerlas: el grupo quedaría arriba del todo.
5. Imágenes: la misma orden con `--window-size=1920,1080` sobre `listing.html?slide=N`. Los títulos y las viñetas usan `text-wrap: balance` y `pretty`, para que no quede una palabra sola en la última línea.
   El icono, con `docs/listing/icon.svg` copiado a la carpeta y `--default-background-color=00000000` para que el fondo sea transparente: `icon.html` a `1024,1024` e `icon.html?size=128` a `128,128`.
6. En Figma, con el Desktop Bridge abierto en el archivo de destino: `new Function('figma', 'SLIDE', 'return (async () => {' + src + '})()')(figma, n)` para cada `n`.
7. Imágenes de los README, en `docs/readme/en/` (README.md) y `docs/readme/es/` (README.es.md), con los mismos nombres:
   - `banner.png`: `banner.html?lang=en` o `?lang=es`, abierto desde el repositorio (`file:///…/docs/listing/source/banner.html`), con `--allow-file-access-from-files --default-background-color=00000000 --force-device-scale-factor=2 --window-size=1280,640`.
   - `findings.png`, `contrast.png`, `slots.png` y `settings.png`: capturas de la UI con `lang=en` o `lang=es` y `view=results`, `view=results&open=contrast&focus=contrast`, `view=results&open=slots&focus=slots` y `view=settings`. Cada una se enmarca con `shot.html?img=<captura>` a `--window-size=976,1496`, con el fondo transparente.
