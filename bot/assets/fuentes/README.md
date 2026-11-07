**English** · [Español](README.es.md)

# The preview's fonts

The ones that draw each agent's image (`src/vista-previa.ts`): the same as the website,
as static TTFs, which is what resvg reads. They live in the repo so as not to depend on
what the machine has installed.

| File | Family and weight | License |
|---|---|---|
| `SpaceGrotesk-Bold.ttf` | Space Grotesk 700 | `OFL-SpaceGrotesk.txt` |
| `SpaceGrotesk-Medium.ttf` | Space Grotesk 500 | `OFL-SpaceGrotesk.txt` |
| `Inter-Regular.ttf` | Inter 400 | `OFL-Inter.txt` |
| `Inter-SemiBold.ttf` | Inter 600 | `OFL-Inter.txt` |

Both are under the SIL Open Font License 1.1: they can be redistributed with their license
alongside, which is what's here. They were downloaded from Google Fonts on 2026-11-07 (Space
Grotesk v22, Inter v20) by requesting the CSS without WOFF2 support, which returns each
weight's TTF.

They cover Latin (including Vietnamese), punctuation and currency signs; Inter also covers
Greek and Cyrillic. What isn't here —emoji, CJK, Arabic, Devanagari— the preview removes
before drawing, instead of drawing empty boxes.
