# Marca de DoD Lint

Dirección «Token», elegida el 02-10-2026. La palomita está hecha de dos píldoras, como las variables en el panel de Figma, y cuenta lo que hace el plugin: enlazar el token que ya tienes. La tinta con lima destaca entre las miniaturas de Community, que suelen ser blancas o moradas, y se aleja del morado de Figma (para que no parezca oficial) y del rojo y el verde de los avisos.

Lema, sin usar todavía: *The token you already have.*

## Colores

| Nombre | Hex | Para qué |
|---|---|---|
| Tinta | `#111318` | Fondo del icono, de las imágenes y de la cabecera de la página de soporte |
| Losa | `#1C1F26` | Fondo de la marca cuando va sobre tinta |
| Niebla | `#EEF0F4` | Texto sobre tinta y el trazo largo de la palomita |
| Lima | `#D4FF3F` | El trazo corto, «lint», las viñetas y la píldora de la miniatura |
| Gris claro | `#A3A9B8` | Subtítulos y texto secundario sobre tinta |
| Pizarra | `#8A90A2` | Viñetas secundarias y adornos |

Contraste sobre tinta: lima 16:1, niebla 16:1, gris claro 7,9:1 y pizarra 5,8:1. La lima sobre blanco se queda en 1,2:1, así que en un fondo claro solo va de fondo (con texto en tinta) o de adorno, nunca de texto.

## Tipografía

Geist para todo y Geist Mono para «lint» y los detalles de código. Las dos tienen licencia OFL: gratis, también para uso comercial y para ir incrustadas. Pesos: 400, 500, 600 y 700; la mono, en 500.

En texto, el nombre se escribe «DoD Lint». El logotipo es «DoD» en Geist Bold y «lint» en Geist Mono, en minúscula y en lima.

## La palomita

`docs/listing/mark.svg`, en una cuadrícula de 64:

- Trazo corto, en lima: de (15,34; 34,14) a (21; 39,8). Trazo largo, en niebla: de (33; 39,8) a (48,56; 24,24).
- Grosor 9, extremos redondeados. Los dos trazos van a 45°, acaban en la misma línea (y = 39,8) y miden 8 y 22.
- Entre los dos extremos de abajo quedan 3 unidades de hueco.
- Con los extremos redondeados, la forma queda centrada en el cuadro.

Hay dos versiones:

- **Icono de Community** (`icon.svg`, `icon-128.png` para el formulario, `icon-1024.png`): a sangre, sin radio, para que no se sumen dos radios si Figma redondea el suyo.
- **Marca con radio** (`mark.svg`, radio 14 de 64): en todo lo demás. Va en los antetítulos de las imágenes, en el panel, en la página de soporte y en su favicon, y se reconoce a 16 px.

## Dónde se aplica

- **Panel del plugin:** sigue los colores de Figma, en claro y en oscuro, y no usa la paleta. Solo lleva la marca, con sus colores, en la pantalla de inicio (40 px) y encima de «Cumple la Definición de hecho» (32 px).
- **Imágenes de la ficha** (`docs/listing/source/listing.html`): fondo tinta con una retícula de puntos (blanco al 7 %, cada 32 px), viñetas en lima (las secundarias en pizarra) y la píldora lima con el texto en tinta.
- **Página de soporte** (`docs/site/index.html`, que genera `npm run support-page` a partir de `docs/support.md`): cabecera en tinta, y el resto en claro o en oscuro según el sistema de quien la lee. Las fuentes no se cargan de Google Fonts, porque una página alojada en la UE que las pide a Google le pasa la IP de cada visitante. Van con la página, en `docs/site/fonts/`: las variables del paquete `geist` 1.7.2, con su licencia en `OFL.txt`. Si faltaran, el script dejaría las fuentes del sistema.
