# Tipografías de la vista previa

Las que dibujan la imagen de cada agente (`src/vista-previa.ts`): las mismas que
la web, en TTF estático, que es lo que lee resvg. Van en el repo para no depender
de lo que tenga instalado la máquina.

| Archivo | Familia y peso | Licencia |
|---|---|---|
| `SpaceGrotesk-Bold.ttf` | Space Grotesk 700 | `OFL-SpaceGrotesk.txt` |
| `SpaceGrotesk-Medium.ttf` | Space Grotesk 500 | `OFL-SpaceGrotesk.txt` |
| `Inter-Regular.ttf` | Inter 400 | `OFL-Inter.txt` |
| `Inter-SemiBold.ttf` | Inter 600 | `OFL-Inter.txt` |

Las dos son SIL Open Font License 1.1: se pueden redistribuir con su licencia al
lado, que es lo que hay aquí. Se bajaron de Google Fonts el 2026-11-07 (Space
Grotesk v22, Inter v20) pidiendo el CSS sin soporte de WOFF2, que devuelve el
TTF de cada peso.

Traen latín (con el vietnamita), signos y monedas; Inter además griego y
cirílico. Lo que no está aquí —emojis, CJK, árabe, devanagari— la vista previa
lo quita antes de dibujar, en vez de pintar cajas vacías.
