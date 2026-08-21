/**
 * Abrir lo que manda un cliente.
 *
 *     npx tsx test/adjuntos.test.ts     (o: npm test)
 *
 * Los archivos de abajo son de verdad. El .docx y el .zip los escribio la
 * `zipfile` de Python y el PNG es el icono de la app, asi que ninguno de los
 * tres lo genero este codigo: un lector probado contra lo que escribe su
 * propio autor comparte con el cualquier malentendido sobre el formato.
 *
 * EL PDF ES LA EXCEPCION Y CONVIENE DECIRLO: lo genero un agente de Panal,
 * porque en esta maquina no habia ninguno hecho por Word ni por Chrome. La
 * extraccion se apoya en pdf.js, que es lo que resuelve las codificaciones de
 * fuente donde se atraganta un extractor casero, pero eso NO queda comprobado
 * aqui. Hace falta un PDF ajeno para cerrar ese hueco.
 */

import { comoTexto, leerAdjuntos, textoDeDocx, textoDeXlsx, tipoDe } from '../template/src/adjuntos.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const deB64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'));
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

const PNG = deB64(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABaUlEQVR42mMQEpD8P5Qxw6gHRj0w6oFRD4x6YNQDI9YDMVEp' +
  '/z+9/0URBpkxIB7Q0jD6f/PaQ4o9ADIDZBbdPdDXPQ3sABA9kGYwkBv6sBCkJPSoYQ5ZHjiw9wTY0tLiWoozIcgMkFkgM+ni' +
  'AWdHb3japVZJAstLILNp7gFKLKNFoDDQM7ppkSwZ6J1xqW0+Az2LPFrYwUBqGiU2dDZXa/5/NEsPA7fGqBBVORKbxxhokT7z' +
  'fJWwOh6GNeWlqZbPGIht7xBbQoAcd6pLG68H5uSoE1XSEdNOYqB2sQlKIvgcD8MOerJUKVap6gFQ6BPjeBAGxRJdPEBqEiKU' +
  'fIjJzFRNQqRm4nA7BaI8gCsjUz0Tk1OM4ipCYRhUStG1GCW1kgFlUHLSPs0qMnKqelAog4pLdAxKYgPSlBjyjblh0ZweFh2a' +
  'Id+lHBad+iE/rDIsBraG/NDi6Oj0qAdGPTDqgVEPjHpg1ANUwABavkjfU0JsNQAAAABJRU5ErkJggg==',
);
const DOCX = deB64(
  'UEsDBBQAAAAIAKe5FV3uR1hmHwAAAB0AAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLOxr8jNUShLLSrOzM+zVTLUM1Cyt7MJ' +
  'qSxILda3AwBQSwMEFAAAAAgAp7kVXVTH5hzpAAAAlwEAABEAAAB3b3JkL2RvY3VtZW50LnhtbIVQzUoEMQy++xSh951WRZFh' +
  'pnuQ9eRBxH2A2MbZwrQpbd1xfXrb9QeUBS8fCcn3kwzrNz/DnlJ2HEZx3ikBFAxbF6ZRbJ/uVjcCcsFgceZAozhQFmt9Niy9' +
  'ZfPqKRSoCiH3yyh2pcReymx25DF3HCnU2Qsnj6W2aZILJxsTG8q5GvhZXih1LT26IHSVfGZ7OGrH1qUGRd9yKAkLgyXIlPbO' +
  'OM6DbKOG6YjxL62l6nNEUzPHRI1IQt8jREyF4Bf/x8p8WmEodHqhsieEK6Vgs33s/g2hH2Z85x4uFVhXP3KKIL/ObsX3S/UH' +
  'UEsBAhQDFAAAAAgAp7kVXe5HWGYfAAAAHQAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMU' +
  'AAAACACnuRVdVMfmHOkAAACXAQAAEQAAAAAAAAAAAAAAgAFQAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAA' +
  'aAEAAAAA',
);
const ZIP = deB64(
  'UEsDBBQAAAAIAKe5FV3cldCDIwAAACEAAAAJAAAAUkVBRE1FLm1kU1YIKMqvTE0uyefiCs1TSCxKzsgsy1dISVUoSa0oydfj' +
  'AgBQSwMEFAAAAAgAp7kVXbIdW4YeAAAAHAAAAAsAAABzcmMvbWFpbi50c0utKMgvKlFIzs8rLlEoKE0tKslXsFWwMLewtOYC' +
  'AFBLAwQUAAAACACnuRVdPnyYNycAAAAlAAAAEQAAAHNyYy91dGlsL2ZlY2hhLnRzS60oyC8qUUjOzysuUcjIr1SwVdDQVLC1' +
  'U8hLLVdwSSxJ1dC05gIAUEsDBBQAAAAIAKe5FV0AAAAAAgAAAAAAAAAGAAAAdmFjaW8vAwBQSwMEFAAAAAgAp7kVXXOMBSkF' +
  'AQAAAAEAAAgAAABsb2dvLmJpbgEAAf/+AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v' +
  'MDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3' +
  'eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/' +
  'wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/1BLAwQUAAAA' +
  'CACnuRVdhgIv8g8AAAANAAAADAAAAGd1YXJkYWRvLnR4dCvOzFNIzs8tKMrMzSwCAFBLAQIUAxQAAAAIAKe5FV3cldCDIwAA' +
  'ACEAAAAJAAAAAAAAAAAAAACAAQAAAABSRUFETUUubWRQSwECFAMUAAAACACnuRVdsh1bhh4AAAAcAAAACwAAAAAAAAAAAAAA' +
  'gAFKAAAAc3JjL21haW4udHNQSwECFAMUAAAACACnuRVdPnyYNycAAAAlAAAAEQAAAAAAAAAAAAAAgAGRAAAAc3JjL3V0aWwv' +
  'ZmVjaGEudHNQSwECFAMUAAAACACnuRVdAAAAAAIAAAAAAAAABgAAAAAAAAAAABAA/UHnAAAAdmFjaW8vUEsBAhQDFAAAAAgA' +
  'p7kVXXOMBSkFAQAAAAEAAAgAAAAAAAAAAAAAAIABDQEAAGxvZ28uYmluUEsBAhQDFAAAAAgAp7kVXYYCL/IPAAAADQAAAAwA' +
  'AAAAAAAAAAAAAIABOAIAAGd1YXJkYWRvLnR4dFBLBQYAAAAABgAGAFMBAABxAgAAAAA=',
);
/** Un Excel escrito por SheetJS, CON tabla de cadenas compartidas. */
const XLSX = deB64(
  'UEsDBBQAAAAAAAAAAABCb/cFQgMAAEIDAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHM8P3htbCB2ZXJzaW9uPSIx' +
  'LjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3Nj' +
  'aGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJy' +
  'SWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlv' +
  'bnNoaXBzL3dvcmtzaGVldCIgVGFyZ2V0PSJ3b3Jrc2hlZXRzL3NoZWV0MS54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQy' +
  'IiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNo' +
  'aXBzL3NoYXJlZFN0cmluZ3MiIFRhcmdldD0ic2hhcmVkU3RyaW5ncy54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQzIiBU' +
  'eXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBz' +
  'L3RoZW1lIiBUYXJnZXQ9InRoZW1lL3RoZW1lMS54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQ0IiBUeXBlPSJodHRwOi8v' +
  'c2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3N0eWxlcyIgVGFy' +
  'Z2V0PSJzdHlsZXMueG1sIi8+PFJlbGF0aW9uc2hpcCBJZD0icklkNSIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZv' +
  'cm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9zaGVldE1ldGFkYXRhIiBUYXJnZXQ9Im1ldGFk' +
  'YXRhLnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAAAAAAADAPiGveHQAA3h0AABMAAAB4bC90aGVtZS90aGVtZTEu' +
  'eG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPGE6dGhlbWUgeG1s' +
  'bnM6YT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL2RyYXdpbmdtbC8yMDA2L21haW4iIG5hbWU9Ik9mZmlj' +
  'ZSBUaGVtZSI+PGE6dGhlbWVFbGVtZW50cz48YTpjbHJTY2hlbWUgbmFtZT0iT2ZmaWNlIj48YTpkazE+PGE6c3lzQ2xyIHZh' +
  'bD0id2luZG93VGV4dCIgbGFzdENscj0iMDAwMDAwIi8+PC9hOmRrMT48YTpsdDE+PGE6c3lzQ2xyIHZhbD0id2luZG93IiBs' +
  'YXN0Q2xyPSJGRkZGRkYiLz48L2E6bHQxPjxhOmRrMj48YTpzcmdiQ2xyIHZhbD0iMUY0OTdEIi8+PC9hOmRrMj48YTpsdDI+' +
  'PGE6c3JnYkNsciB2YWw9IkVFRUNFMSIvPjwvYTpsdDI+PGE6YWNjZW50MT48YTpzcmdiQ2xyIHZhbD0iNEY4MUJEIi8+PC9h' +
  'OmFjY2VudDE+PGE6YWNjZW50Mj48YTpzcmdiQ2xyIHZhbD0iQzA1MDREIi8+PC9hOmFjY2VudDI+PGE6YWNjZW50Mz48YTpz' +
  'cmdiQ2xyIHZhbD0iOUJCQjU5Ii8+PC9hOmFjY2VudDM+PGE6YWNjZW50ND48YTpzcmdiQ2xyIHZhbD0iODA2NEEyIi8+PC9h' +
  'OmFjY2VudDQ+PGE6YWNjZW50NT48YTpzcmdiQ2xyIHZhbD0iNEJBQ0M2Ii8+PC9hOmFjY2VudDU+PGE6YWNjZW50Nj48YTpz' +
  'cmdiQ2xyIHZhbD0iRjc5NjQ2Ii8+PC9hOmFjY2VudDY+PGE6aGxpbms+PGE6c3JnYkNsciB2YWw9IjAwMDBGRiIvPjwvYTpo' +
  'bGluaz48YTpmb2xIbGluaz48YTpzcmdiQ2xyIHZhbD0iODAwMDgwIi8+PC9hOmZvbEhsaW5rPjwvYTpjbHJTY2hlbWU+PGE6' +
  'Zm9udFNjaGVtZSBuYW1lPSJPZmZpY2UiPjxhOm1ham9yRm9udD48YTpsYXRpbiB0eXBlZmFjZT0iQ2FtYnJpYSIvPjxhOmVh' +
  'IHR5cGVmYWNlPSIiLz48YTpjcyB0eXBlZmFjZT0iIi8+PGE6Zm9udCBzY3JpcHQ9IkpwYW4iIHR5cGVmYWNlPSLvvK3vvLMg' +
  '77yw44K044K344OD44KvIi8+PGE6Zm9udCBzY3JpcHQ9IkhhbmciIHR5cGVmYWNlPSLrp5HsnYAg6rOg65SVIi8+PGE6Zm9u' +
  'dCBzY3JpcHQ9IkhhbnMiIHR5cGVmYWNlPSLlrovkvZMiLz48YTpmb250IHNjcmlwdD0iSGFudCIgdHlwZWZhY2U9IuaWsOe0' +
  'sOaYjumrlCIvPjxhOmZvbnQgc2NyaXB0PSJBcmFiIiB0eXBlZmFjZT0iVGltZXMgTmV3IFJvbWFuIi8+PGE6Zm9udCBzY3Jp' +
  'cHQ9IkhlYnIiIHR5cGVmYWNlPSJUaW1lcyBOZXcgUm9tYW4iLz48YTpmb250IHNjcmlwdD0iVGhhaSIgdHlwZWZhY2U9IlRh' +
  'aG9tYSIvPjxhOmZvbnQgc2NyaXB0PSJFdGhpIiB0eXBlZmFjZT0iTnlhbGEiLz48YTpmb250IHNjcmlwdD0iQmVuZyIgdHlw' +
  'ZWZhY2U9IlZyaW5kYSIvPjxhOmZvbnQgc2NyaXB0PSJHdWpyIiB0eXBlZmFjZT0iU2hydXRpIi8+PGE6Zm9udCBzY3JpcHQ9' +
  'IktobXIiIHR5cGVmYWNlPSJNb29sQm9yYW4iLz48YTpmb250IHNjcmlwdD0iS25kYSIgdHlwZWZhY2U9IlR1bmdhIi8+PGE6' +
  'Zm9udCBzY3JpcHQ9Ikd1cnUiIHR5cGVmYWNlPSJSYWF2aSIvPjxhOmZvbnQgc2NyaXB0PSJDYW5zIiB0eXBlZmFjZT0iRXVw' +
  'aGVtaWEiLz48YTpmb250IHNjcmlwdD0iQ2hlciIgdHlwZWZhY2U9IlBsYW50YWdlbmV0IENoZXJva2VlIi8+PGE6Zm9udCBz' +
  'Y3JpcHQ9IllpaWkiIHR5cGVmYWNlPSJNaWNyb3NvZnQgWWkgQmFpdGkiLz48YTpmb250IHNjcmlwdD0iVGlidCIgdHlwZWZh' +
  'Y2U9Ik1pY3Jvc29mdCBIaW1hbGF5YSIvPjxhOmZvbnQgc2NyaXB0PSJUaGFhIiB0eXBlZmFjZT0iTVYgQm9saSIvPjxhOmZv' +
  'bnQgc2NyaXB0PSJEZXZhIiB0eXBlZmFjZT0iTWFuZ2FsIi8+PGE6Zm9udCBzY3JpcHQ9IlRlbHUiIHR5cGVmYWNlPSJHYXV0' +
  'YW1pIi8+PGE6Zm9udCBzY3JpcHQ9IlRhbWwiIHR5cGVmYWNlPSJMYXRoYSIvPjxhOmZvbnQgc2NyaXB0PSJTeXJjIiB0eXBl' +
  'ZmFjZT0iRXN0cmFuZ2VsbyBFZGVzc2EiLz48YTpmb250IHNjcmlwdD0iT3J5YSIgdHlwZWZhY2U9IkthbGluZ2EiLz48YTpm' +
  'b250IHNjcmlwdD0iTWx5bSIgdHlwZWZhY2U9IkthcnRpa2EiLz48YTpmb250IHNjcmlwdD0iTGFvbyIgdHlwZWZhY2U9IkRv' +
  'a0NoYW1wYSIvPjxhOmZvbnQgc2NyaXB0PSJTaW5oIiB0eXBlZmFjZT0iSXNrb29sYSBQb3RhIi8+PGE6Zm9udCBzY3JpcHQ9' +
  'Ik1vbmciIHR5cGVmYWNlPSJNb25nb2xpYW4gQmFpdGkiLz48YTpmb250IHNjcmlwdD0iVmlldCIgdHlwZWZhY2U9IlRpbWVz' +
  'IE5ldyBSb21hbiIvPjxhOmZvbnQgc2NyaXB0PSJVaWdoIiB0eXBlZmFjZT0iTWljcm9zb2Z0IFVpZ2h1ciIvPjxhOmZvbnQg' +
  'c2NyaXB0PSJHZW9yIiB0eXBlZmFjZT0iU3lsZmFlbiIvPjwvYTptYWpvckZvbnQ+PGE6bWlub3JGb250PjxhOmxhdGluIHR5' +
  'cGVmYWNlPSJDYWxpYnJpIi8+PGE6ZWEgdHlwZWZhY2U9IiIvPjxhOmNzIHR5cGVmYWNlPSIiLz48YTpmb250IHNjcmlwdD0i' +
  'SnBhbiIgdHlwZWZhY2U9Iu+8re+8syDvvLDjgrTjgrfjg4Pjgq8iLz48YTpmb250IHNjcmlwdD0iSGFuZyIgdHlwZWZhY2U9' +
  'IuunkeydgCDqs6DrlJUiLz48YTpmb250IHNjcmlwdD0iSGFucyIgdHlwZWZhY2U9IuWui+S9kyIvPjxhOmZvbnQgc2NyaXB0' +
  'PSJIYW50IiB0eXBlZmFjZT0i5paw57Sw5piO6auUIi8+PGE6Zm9udCBzY3JpcHQ9IkFyYWIiIHR5cGVmYWNlPSJBcmlhbCIv' +
  'PjxhOmZvbnQgc2NyaXB0PSJIZWJyIiB0eXBlZmFjZT0iQXJpYWwiLz48YTpmb250IHNjcmlwdD0iVGhhaSIgdHlwZWZhY2U9' +
  'IlRhaG9tYSIvPjxhOmZvbnQgc2NyaXB0PSJFdGhpIiB0eXBlZmFjZT0iTnlhbGEiLz48YTpmb250IHNjcmlwdD0iQmVuZyIg' +
  'dHlwZWZhY2U9IlZyaW5kYSIvPjxhOmZvbnQgc2NyaXB0PSJHdWpyIiB0eXBlZmFjZT0iU2hydXRpIi8+PGE6Zm9udCBzY3Jp' +
  'cHQ9IktobXIiIHR5cGVmYWNlPSJEYXVuUGVuaCIvPjxhOmZvbnQgc2NyaXB0PSJLbmRhIiB0eXBlZmFjZT0iVHVuZ2EiLz48' +
  'YTpmb250IHNjcmlwdD0iR3VydSIgdHlwZWZhY2U9IlJhYXZpIi8+PGE6Zm9udCBzY3JpcHQ9IkNhbnMiIHR5cGVmYWNlPSJF' +
  'dXBoZW1pYSIvPjxhOmZvbnQgc2NyaXB0PSJDaGVyIiB0eXBlZmFjZT0iUGxhbnRhZ2VuZXQgQ2hlcm9rZWUiLz48YTpmb250' +
  'IHNjcmlwdD0iWWlpaSIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBZaSBCYWl0aSIvPjxhOmZvbnQgc2NyaXB0PSJUaWJ0IiB0eXBl' +
  'ZmFjZT0iTWljcm9zb2Z0IEhpbWFsYXlhIi8+PGE6Zm9udCBzY3JpcHQ9IlRoYWEiIHR5cGVmYWNlPSJNViBCb2xpIi8+PGE6' +
  'Zm9udCBzY3JpcHQ9IkRldmEiIHR5cGVmYWNlPSJNYW5nYWwiLz48YTpmb250IHNjcmlwdD0iVGVsdSIgdHlwZWZhY2U9Ikdh' +
  'dXRhbWkiLz48YTpmb250IHNjcmlwdD0iVGFtbCIgdHlwZWZhY2U9IkxhdGhhIi8+PGE6Zm9udCBzY3JpcHQ9IlN5cmMiIHR5' +
  'cGVmYWNlPSJFc3RyYW5nZWxvIEVkZXNzYSIvPjxhOmZvbnQgc2NyaXB0PSJPcnlhIiB0eXBlZmFjZT0iS2FsaW5nYSIvPjxh' +
  'OmZvbnQgc2NyaXB0PSJNbHltIiB0eXBlZmFjZT0iS2FydGlrYSIvPjxhOmZvbnQgc2NyaXB0PSJMYW9vIiB0eXBlZmFjZT0i' +
  'RG9rQ2hhbXBhIi8+PGE6Zm9udCBzY3JpcHQ9IlNpbmgiIHR5cGVmYWNlPSJJc2tvb2xhIFBvdGEiLz48YTpmb250IHNjcmlw' +
  'dD0iTW9uZyIgdHlwZWZhY2U9Ik1vbmdvbGlhbiBCYWl0aSIvPjxhOmZvbnQgc2NyaXB0PSJWaWV0IiB0eXBlZmFjZT0iQXJp' +
  'YWwiLz48YTpmb250IHNjcmlwdD0iVWlnaCIgdHlwZWZhY2U9Ik1pY3Jvc29mdCBVaWdodXIiLz48YTpmb250IHNjcmlwdD0i' +
  'R2VvciIgdHlwZWZhY2U9IlN5bGZhZW4iLz48L2E6bWlub3JGb250PjwvYTpmb250U2NoZW1lPjxhOmZtdFNjaGVtZSBuYW1l' +
  'PSJPZmZpY2UiPjxhOmZpbGxTdHlsZUxzdD48YTpzb2xpZEZpbGw+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiLz48L2E6c29s' +
  'aWRGaWxsPjxhOmdyYWRGaWxsIHJvdFdpdGhTaGFwZT0iMSI+PGE6Z3NMc3Q+PGE6Z3MgcG9zPSIwIj48YTpzY2hlbWVDbHIg' +
  'dmFsPSJwaENsciI+PGE6dGludCB2YWw9IjUwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMzAwMDAwIi8+PC9hOnNjaGVtZUNscj48' +
  'L2E6Z3M+PGE6Z3MgcG9zPSIzNTAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSIzNzAwMCIvPjxh' +
  'OnNhdE1vZCB2YWw9IjMwMDAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOmdzPjxhOmdzIHBvcz0iMTAwMDAwIj48YTpzY2hlbWVD' +
  'bHIgdmFsPSJwaENsciI+PGE6dGludCB2YWw9IjE1MDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNs' +
  'cj48L2E6Z3M+PC9hOmdzTHN0PjxhOmxpbiBhbmc9IjE2MjAwMDAwIiBzY2FsZWQ9IjEiLz48L2E6Z3JhZEZpbGw+PGE6Z3Jh' +
  'ZEZpbGwgcm90V2l0aFNoYXBlPSIxIj48YTpnc0xzdD48YTpncyBwb3M9IjAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48' +
  'YTp0aW50IHZhbD0iMTAwMDAwIi8+PGE6c2hhZGUgdmFsPSIxMDAwMDAiLz48YTpzYXRNb2QgdmFsPSIxMzAwMDAiLz48L2E6' +
  'c2NoZW1lQ2xyPjwvYTpncz48YTpncyBwb3M9IjEwMDAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnRpbnQgdmFs' +
  'PSI1MDAwMCIvPjxhOnNoYWRlIHZhbD0iMTAwMDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48' +
  'L2E6Z3M+PC9hOmdzTHN0PjxhOmxpbiBhbmc9IjE2MjAwMDAwIiBzY2FsZWQ9IjAiLz48L2E6Z3JhZEZpbGw+PC9hOmZpbGxT' +
  'dHlsZUxzdD48YTpsblN0eWxlTHN0PjxhOmxuIHc9Ijk1MjUiIGNhcD0iZmxhdCIgY21wZD0ic25nIiBhbGduPSJjdHIiPjxh' +
  'OnNvbGlkRmlsbD48YTpzY2hlbWVDbHIgdmFsPSJwaENsciI+PGE6c2hhZGUgdmFsPSI5NTAwMCIvPjxhOnNhdE1vZCB2YWw9' +
  'IjEwNTAwMCIvPjwvYTpzY2hlbWVDbHI+PC9hOnNvbGlkRmlsbD48YTpwcnN0RGFzaCB2YWw9InNvbGlkIi8+PC9hOmxuPjxh' +
  'OmxuIHc9IjI1NDAwIiBjYXA9ImZsYXQiIGNtcGQ9InNuZyIgYWxnbj0iY3RyIj48YTpzb2xpZEZpbGw+PGE6c2NoZW1lQ2xy' +
  'IHZhbD0icGhDbHIiLz48L2E6c29saWRGaWxsPjxhOnByc3REYXNoIHZhbD0ic29saWQiLz48L2E6bG4+PGE6bG4gdz0iMzgx' +
  'MDAiIGNhcD0iZmxhdCIgY21wZD0ic25nIiBhbGduPSJjdHIiPjxhOnNvbGlkRmlsbD48YTpzY2hlbWVDbHIgdmFsPSJwaENs' +
  'ciIvPjwvYTpzb2xpZEZpbGw+PGE6cHJzdERhc2ggdmFsPSJzb2xpZCIvPjwvYTpsbj48L2E6bG5TdHlsZUxzdD48YTplZmZl' +
  'Y3RTdHlsZUxzdD48YTplZmZlY3RTdHlsZT48YTplZmZlY3RMc3Q+PGE6b3V0ZXJTaGR3IGJsdXJSYWQ9IjQwMDAwIiBkaXN0' +
  'PSIyMDAwMCIgZGlyPSI1NDAwMDAwIiByb3RXaXRoU2hhcGU9IjAiPjxhOnNyZ2JDbHIgdmFsPSIwMDAwMDAiPjxhOmFscGhh' +
  'IHZhbD0iMzgwMDAiLz48L2E6c3JnYkNscj48L2E6b3V0ZXJTaGR3PjwvYTplZmZlY3RMc3Q+PC9hOmVmZmVjdFN0eWxlPjxh' +
  'OmVmZmVjdFN0eWxlPjxhOmVmZmVjdExzdD48YTpvdXRlclNoZHcgYmx1clJhZD0iNDAwMDAiIGRpc3Q9IjIzMDAwIiBkaXI9' +
  'IjU0MDAwMDAiIHJvdFdpdGhTaGFwZT0iMCI+PGE6c3JnYkNsciB2YWw9IjAwMDAwMCI+PGE6YWxwaGEgdmFsPSIzNTAwMCIv' +
  'PjwvYTpzcmdiQ2xyPjwvYTpvdXRlclNoZHc+PC9hOmVmZmVjdExzdD48L2E6ZWZmZWN0U3R5bGU+PGE6ZWZmZWN0U3R5bGU+' +
  'PGE6ZWZmZWN0THN0PjxhOm91dGVyU2hkdyBibHVyUmFkPSI0MDAwMCIgZGlzdD0iMjMwMDAiIGRpcj0iNTQwMDAwMCIgcm90' +
  'V2l0aFNoYXBlPSIwIj48YTpzcmdiQ2xyIHZhbD0iMDAwMDAwIj48YTphbHBoYSB2YWw9IjM1MDAwIi8+PC9hOnNyZ2JDbHI+' +
  'PC9hOm91dGVyU2hkdz48L2E6ZWZmZWN0THN0PjxhOnNjZW5lM2Q+PGE6Y2FtZXJhIHByc3Q9Im9ydGhvZ3JhcGhpY0Zyb250' +
  'Ij48YTpyb3QgbGF0PSIwIiBsb249IjAiIHJldj0iMCIvPjwvYTpjYW1lcmE+PGE6bGlnaHRSaWcgcmlnPSJ0aHJlZVB0IiBk' +
  'aXI9InQiPjxhOnJvdCBsYXQ9IjAiIGxvbj0iMCIgcmV2PSIxMjAwMDAwIi8+PC9hOmxpZ2h0UmlnPjwvYTpzY2VuZTNkPjxh' +
  'OnNwM2Q+PGE6YmV2ZWxUIHc9IjYzNTAwIiBoPSIyNTQwMCIvPjwvYTpzcDNkPjwvYTplZmZlY3RTdHlsZT48L2E6ZWZmZWN0' +
  'U3R5bGVMc3Q+PGE6YmdGaWxsU3R5bGVMc3Q+PGE6c29saWRGaWxsPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIi8+PC9hOnNv' +
  'bGlkRmlsbD48YTpncmFkRmlsbCByb3RXaXRoU2hhcGU9IjEiPjxhOmdzTHN0PjxhOmdzIHBvcz0iMCI+PGE6c2NoZW1lQ2xy' +
  'IHZhbD0icGhDbHIiPjxhOnRpbnQgdmFsPSI0MDAwMCIvPjxhOnNhdE1vZCB2YWw9IjM1MDAwMCIvPjwvYTpzY2hlbWVDbHI+' +
  'PC9hOmdzPjxhOmdzIHBvcz0iNDAwMDAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTp0aW50IHZhbD0iNDUwMDAiLz48' +
  'YTpzaGFkZSB2YWw9Ijk5MDAwIi8+PGE6c2F0TW9kIHZhbD0iMzUwMDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PGE6Z3Mg' +
  'cG9zPSIxMDAwMDAiPjxhOnNjaGVtZUNsciB2YWw9InBoQ2xyIj48YTpzaGFkZSB2YWw9IjIwMDAwIi8+PGE6c2F0TW9kIHZh' +
  'bD0iMjU1MDAwIi8+PC9hOnNjaGVtZUNscj48L2E6Z3M+PC9hOmdzTHN0PjxhOnBhdGggcGF0aD0iY2lyY2xlIj48YTpmaWxs' +
  'VG9SZWN0IGw9IjUwMDAwIiB0PSItODAwMDAiIHI9IjUwMDAwIiBiPSIxODAwMDAiLz48L2E6cGF0aD48L2E6Z3JhZEZpbGw+' +
  'PGE6Z3JhZEZpbGwgcm90V2l0aFNoYXBlPSIxIj48YTpnc0xzdD48YTpncyBwb3M9IjAiPjxhOnNjaGVtZUNsciB2YWw9InBo' +
  'Q2xyIj48YTp0aW50IHZhbD0iODAwMDAiLz48YTpzYXRNb2QgdmFsPSIzMDAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48' +
  'YTpncyBwb3M9IjEwMDAwMCI+PGE6c2NoZW1lQ2xyIHZhbD0icGhDbHIiPjxhOnNoYWRlIHZhbD0iMzAwMDAiLz48YTpzYXRN' +
  'b2QgdmFsPSIyMDAwMDAiLz48L2E6c2NoZW1lQ2xyPjwvYTpncz48L2E6Z3NMc3Q+PGE6cGF0aCBwYXRoPSJjaXJjbGUiPjxh' +
  'OmZpbGxUb1JlY3QgbD0iNTAwMDAiIHQ9IjUwMDAwIiByPSI1MDAwMCIgYj0iNTAwMDAiLz48L2E6cGF0aD48L2E6Z3JhZEZp' +
  'bGw+PC9hOmJnRmlsbFN0eWxlTHN0PjwvYTpmbXRTY2hlbWU+PC9hOnRoZW1lRWxlbWVudHM+PGE6b2JqZWN0RGVmYXVsdHM+' +
  'PGE6c3BEZWY+PGE6c3BQci8+PGE6Ym9keVByLz48YTpsc3RTdHlsZS8+PGE6c3R5bGU+PGE6bG5SZWYgaWR4PSIxIj48YTpz' +
  'Y2hlbWVDbHIgdmFsPSJhY2NlbnQxIi8+PC9hOmxuUmVmPjxhOmZpbGxSZWYgaWR4PSIzIj48YTpzY2hlbWVDbHIgdmFsPSJh' +
  'Y2NlbnQxIi8+PC9hOmZpbGxSZWY+PGE6ZWZmZWN0UmVmIGlkeD0iMiI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwv' +
  'YTplZmZlY3RSZWY+PGE6Zm9udFJlZiBpZHg9Im1pbm9yIj48YTpzY2hlbWVDbHIgdmFsPSJsdDEiLz48L2E6Zm9udFJlZj48' +
  'L2E6c3R5bGU+PC9hOnNwRGVmPjxhOmxuRGVmPjxhOnNwUHIvPjxhOmJvZHlQci8+PGE6bHN0U3R5bGUvPjxhOnN0eWxlPjxh' +
  'OmxuUmVmIGlkeD0iMiI+PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTpsblJlZj48YTpmaWxsUmVmIGlkeD0iMCI+' +
  'PGE6c2NoZW1lQ2xyIHZhbD0iYWNjZW50MSIvPjwvYTpmaWxsUmVmPjxhOmVmZmVjdFJlZiBpZHg9IjEiPjxhOnNjaGVtZUNs' +
  'ciB2YWw9ImFjY2VudDEiLz48L2E6ZWZmZWN0UmVmPjxhOmZvbnRSZWYgaWR4PSJtaW5vciI+PGE6c2NoZW1lQ2xyIHZhbD0i' +
  'dHgxIi8+PC9hOmZvbnRSZWY+PC9hOnN0eWxlPjwvYTpsbkRlZj48L2E6b2JqZWN0RGVmYXVsdHM+PGE6ZXh0cmFDbHJTY2hl' +
  'bWVMc3QvPjwvYTp0aGVtZT5QSwMEFAAAAAAAAAAAAFX0BJRaBAAAWgQAAA0AAAB4bC9zdHlsZXMueG1sPD94bWwgdmVyc2lv' +
  'bj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPHN0eWxlU2hlZXQgeG1sbnM9Imh0dHA6Ly9z' +
  'Y2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6dnQ9Imh0dHA6Ly9zY2hl' +
  'bWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L2RvY1Byb3BzVlR5cGVzIj48bnVtRm10cyBjb3Vu' +
  'dD0iMSI+PG51bUZtdCBudW1GbXRJZD0iNTYiIGZvcm1hdENvZGU9IiZxdW90O+S4iuWNiC/kuIvljYggJnF1b3Q7aGgmcXVv' +
  'dDvmmYImcXVvdDttbSZxdW90O+WIhiZxdW90O3NzJnF1b3Q756eSICZxdW90OyIvPjwvbnVtRm10cz48Zm9udHMgY291bnQ9' +
  'IjEiPjxmb250PjxzeiB2YWw9IjEyIi8+PGNvbG9yIHRoZW1lPSIxIi8+PG5hbWUgdmFsPSJDYWxpYnJpIi8+PGZhbWlseSB2' +
  'YWw9IjIiLz48c2NoZW1lIHZhbD0ibWlub3IiLz48L2ZvbnQ+PC9mb250cz48ZmlsbHMgY291bnQ9IjIiPjxmaWxsPjxwYXR0' +
  'ZXJuRmlsbCBwYXR0ZXJuVHlwZT0ibm9uZSIvPjwvZmlsbD48ZmlsbD48cGF0dGVybkZpbGwgcGF0dGVyblR5cGU9ImdyYXkx' +
  'MjUiLz48L2ZpbGw+PC9maWxscz48Ym9yZGVycyBjb3VudD0iMSI+PGJvcmRlcj48bGVmdC8+PHJpZ2h0Lz48dG9wLz48Ym90' +
  'dG9tLz48ZGlhZ29uYWwvPjwvYm9yZGVyPjwvYm9yZGVycz48Y2VsbFN0eWxlWGZzIGNvdW50PSIxIj48eGYgbnVtRm10SWQ9' +
  'IjAiIGZvbnRJZD0iMCIgZmlsbElkPSIwIiBib3JkZXJJZD0iMCIvPjwvY2VsbFN0eWxlWGZzPjxjZWxsWGZzIGNvdW50PSIx' +
  'Ij48eGYgbnVtRm10SWQ9IjAiIGZvbnRJZD0iMCIgZmlsbElkPSIwIiBib3JkZXJJZD0iMCIgeGZJZD0iMCIgYXBwbHlOdW1i' +
  'ZXJGb3JtYXQ9IjEiLz48L2NlbGxYZnM+PGNlbGxTdHlsZXMgY291bnQ9IjEiPjxjZWxsU3R5bGUgbmFtZT0iTm9ybWFsIiB4' +
  'ZklkPSIwIiBidWlsdGluSWQ9IjAiLz48L2NlbGxTdHlsZXM+PGR4ZnMgY291bnQ9IjAiLz48dGFibGVTdHlsZXMgY291bnQ9' +
  'IjAiIGRlZmF1bHRUYWJsZVN0eWxlPSJUYWJsZVN0eWxlTWVkaXVtOSIgZGVmYXVsdFBpdm90U3R5bGU9IlBpdm90U3R5bGVN' +
  'ZWRpdW00Ii8+PC9zdHlsZVNoZWV0PlBLAwQUAAAAAAAAAAAAnIluF/8CAAD/AgAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQx' +
  'LnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4NCjx3b3Jrc2hlZXQg' +
  'eG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6' +
  'cj0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcyI+' +
  'PGRpbWVuc2lvbiByZWY9IkExOkI1Ii8+PHNoZWV0Vmlld3M+PHNoZWV0VmlldyB3b3JrYm9va1ZpZXdJZD0iMCIvPjwvc2hl' +
  'ZXRWaWV3cz48c2hlZXREYXRhPjxyb3cgcj0iMSI+PGMgcj0iQTEiIHQ9InMiPjx2PjA8L3Y+PC9jPjxjIHI9IkIxIiB0PSJz' +
  'Ij48dj4xPC92PjwvYz48L3Jvdz48cm93IHI9IjIiPjxjIHI9IkEyIiB0PSJzIj48dj4yPC92PjwvYz48YyByPSJCMiI+PHY+' +
  'MTUwMDA8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iMyI+PGMgcj0iQTMiIHQ9InMiPjx2PjM8L3Y+PC9jPjxjIHI9IkIzIj48dj4x' +
  'MDA8L3Y+PC9jPjwvcm93Pjxyb3cgcj0iNCI+PGMgcj0iQTQiIHQ9InMiPjx2PjQ8L3Y+PC9jPjxjIHI9IkI0IiB0PSJzIj48' +
  'dj40PC92PjwvYz48L3Jvdz48cm93IHI9IjUiPjxjIHI9IkE1IiB0PSJzIj48dj41PC92PjwvYz48YyByPSJCNSI+PHY+MTUx' +
  'MDA8L3Y+PC9jPjwvcm93Pjwvc2hlZXREYXRhPjxpZ25vcmVkRXJyb3JzPjxpZ25vcmVkRXJyb3IgbnVtYmVyU3RvcmVkQXNU' +
  'ZXh0PSIxIiBzcXJlZj0iQTE6QjUiLz48L2lnbm9yZWRFcnJvcnM+PC93b3Jrc2hlZXQ+UEsDBBQAAAAAAAAAAABggACBiAMA' +
  'AIgDAAAPAAAAeGwvbWV0YWRhdGEueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9' +
  'InllcyI/Pg0KPG1ldGFkYXRhIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvc3ByZWFkc2hlZXRt' +
  'bC8yMDA2L21haW4iIHhtbG5zOnhscmQ9Imh0dHA6Ly9zY2hlbWFzLm1pY3Jvc29mdC5jb20vb2ZmaWNlL3NwcmVhZHNoZWV0' +
  'bWwvMjAxNy9yaWNoZGF0YSIgeG1sbnM6eGRhPSJodHRwOi8vc2NoZW1hcy5taWNyb3NvZnQuY29tL29mZmljZS9zcHJlYWRz' +
  'aGVldG1sLzIwMTcvZHluYW1pY2FycmF5Ij4KICA8bWV0YWRhdGFUeXBlcyBjb3VudD0iMSI+CiAgICA8bWV0YWRhdGFUeXBl' +
  'IG5hbWU9IlhMREFQUiIgbWluU3VwcG9ydGVkVmVyc2lvbj0iMTIwMDAwIiBjb3B5PSIxIiBwYXN0ZUFsbD0iMSIgcGFzdGVW' +
  'YWx1ZXM9IjEiIG1lcmdlPSIxIiBzcGxpdEZpcnN0PSIxIiByb3dDb2xTaGlmdD0iMSIgY2xlYXJGb3JtYXRzPSIxIiBjbGVh' +
  'ckNvbW1lbnRzPSIxIiBhc3NpZ249IjEiIGNvZXJjZT0iMSIgY2VsbE1ldGE9IjEiLz4KICA8L21ldGFkYXRhVHlwZXM+CiAg' +
  'PGZ1dHVyZU1ldGFkYXRhIG5hbWU9IlhMREFQUiIgY291bnQ9IjEiPgogICAgPGJrPgogICAgICA8ZXh0THN0PgogICAgICAg' +
  'IDxleHQgdXJpPSJ7YmRiYjhjZGMtZmExZS00OTZlLWE4NTctM2MzZjMwYzAyOWMzfSI+CiAgICAgICAgICA8eGRhOmR5bmFt' +
  'aWNBcnJheVByb3BlcnRpZXMgZkR5bmFtaWM9IjEiIGZDb2xsYXBzZWQ9IjAiLz4KICAgICAgICA8L2V4dD4KICAgICAgPC9l' +
  'eHRMc3Q+CiAgICA8L2JrPgogIDwvZnV0dXJlTWV0YWRhdGE+CiAgPGNlbGxNZXRhZGF0YSBjb3VudD0iMSI+CiAgICA8Yms+' +
  'CiAgICAgIDxyYyB0PSIxIiB2PSIwIi8+CiAgICA8L2JrPgogIDwvY2VsbE1ldGFkYXRhPgo8L21ldGFkYXRhPlBLAwQUAAAA' +
  'AAAAAAAAKdTe+kMBAABDAQAADwAAAHhsL3dvcmtib29rLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04' +
  'IiBzdGFuZGFsb25lPSJ5ZXMiPz4NCjx3b3JrYm9vayB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3Jn' +
  'L3NwcmVhZHNoZWV0bWwvMjAwNi9tYWluIiB4bWxuczpyPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2Zm' +
  'aWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzIj48d29ya2Jvb2tQciBjb2RlTmFtZT0iVGhpc1dvcmtib29rIi8+PHNo' +
  'ZWV0cz48c2hlZXQgbmFtZT0iRmFjdHVyYSIgc2hlZXRJZD0iMSIgcjppZD0icklkMSIvPjwvc2hlZXRzPjwvd29ya2Jvb2s+' +
  'UEsDBBQAAAAAAAAAAACex85YKQEAACkBAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWw8P3htbCB2ZXJzaW9uPSIxLjAiIGVu' +
  'Y29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8c3N0IHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9y' +
  'bWF0cy5vcmcvc3ByZWFkc2hlZXRtbC8yMDA2L21haW4iIGNvdW50PSI3IiB1bmlxdWVDb3VudD0iNiI+PHNpPjx0PkNvbmNl' +
  'cHRvPC90Pjwvc2k+PHNpPjx0PkltcG9ydGU8L3Q+PC9zaT48c2k+PHQ+QXVkaXRvcsOtYTwvdD48L3NpPjxzaT48dD5UcmFk' +
  'dWNjacOzbjwvdD48L3NpPjxzaT48dD48L3Q+PC9zaT48c2k+PHQ+VG90YWw8L3Q+PC9zaT48L3NzdD5QSwMEFAAAAAAAAAAA' +
  'AEpqEflMAgAATAIAAAsAAABfcmVscy8ucmVsczw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFs' +
  'b25lPSJ5ZXMiPz4NCjxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFj' +
  'a2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPjxSZWxhdGlvbnNoaXAgSWQ9InJJZDIiIFR5cGU9Imh0dHA6Ly9zY2hlbWFzLm9w' +
  'ZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvcmVsYXRpb25zaGlwcy9tZXRhZGF0YS9jb3JlLXByb3BlcnRpZXMiIFRh' +
  'cmdldD0iZG9jUHJvcHMvY29yZS54bWwiLz48UmVsYXRpb25zaGlwIElkPSJySWQzIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5v' +
  'cGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL2V4dGVuZGVkLXByb3BlcnRpZXMi' +
  'IFRhcmdldD0iZG9jUHJvcHMvYXBwLnhtbCIvPjxSZWxhdGlvbnNoaXAgSWQ9InJJZDEiIFR5cGU9Imh0dHA6Ly9zY2hlbWFz' +
  'Lm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMvb2ZmaWNlRG9jdW1lbnQiIFRh' +
  'cmdldD0ieGwvd29ya2Jvb2sueG1sIi8+PC9SZWxhdGlvbnNoaXBzPlBLAwQUAAAAAAAAAAAAsBxzyjMCAAAzAgAAEAAAAGRv' +
  'Y1Byb3BzL2FwcC54bWw8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8' +
  'UHJvcGVydGllcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYv' +
  'ZXh0ZW5kZWQtcHJvcGVydGllcyIgeG1sbnM6dnQ9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VE' +
  'b2N1bWVudC8yMDA2L2RvY1Byb3BzVlR5cGVzIj48QXBwbGljYXRpb24+U2hlZXRKUzwvQXBwbGljYXRpb24+PEhlYWRpbmdQ' +
  'YWlycz48dnQ6dmVjdG9yIHNpemU9IjIiIGJhc2VUeXBlPSJ2YXJpYW50Ij48dnQ6dmFyaWFudD48dnQ6bHBzdHI+V29ya3No' +
  'ZWV0czwvdnQ6bHBzdHI+PC92dDp2YXJpYW50Pjx2dDp2YXJpYW50Pjx2dDppND4xPC92dDppND48L3Z0OnZhcmlhbnQ+PC92' +
  'dDp2ZWN0b3I+PC9IZWFkaW5nUGFpcnM+PFRpdGxlc09mUGFydHM+PHZ0OnZlY3RvciBzaXplPSIxIiBiYXNlVHlwZT0ibHBz' +
  'dHIiPjx2dDpscHN0cj5GYWN0dXJhPC92dDpscHN0cj48L3Z0OnZlY3Rvcj48L1RpdGxlc09mUGFydHM+PC9Qcm9wZXJ0aWVz' +
  'PlBLAwQUAAAAAAAAAAAA1pJ8EVoBAABaAQAAEQAAAGRvY1Byb3BzL2NvcmUueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNv' +
  'ZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pg0KPGNwOmNvcmVQcm9wZXJ0aWVzIHhtbG5zOmNwPSJodHRwOi8vc2No' +
  'ZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L21ldGFkYXRhL2NvcmUtcHJvcGVydGllcyIgeG1sbnM6ZGM9' +
  'Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIiB4bWxuczpkY3Rlcm1zPSJodHRwOi8vcHVybC5vcmcvZGMvdGVy' +
  'bXMvIiB4bWxuczpkY21pdHlwZT0iaHR0cDovL3B1cmwub3JnL2RjL2RjbWl0eXBlLyIgeG1sbnM6eHNpPSJodHRwOi8vd3d3' +
  'LnczLm9yZy8yMDAxL1hNTFNjaGVtYS1pbnN0YW5jZSIvPlBLAwQUAAAAAAAAAAAAdnmU6p0IAACdCAAAEwAAAFtDb250ZW50' +
  'X1R5cGVzXS54bWw8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+DQo8VHlw' +
  'ZXMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvY29udGVudC10eXBlcyIg' +
  'eG1sbnM6eHNkPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSIgeG1sbnM6eHNpPSJodHRwOi8vd3d3LnczLm9y' +
  'Zy8yMDAxL1hNTFNjaGVtYS1pbnN0YW5jZSI+PERlZmF1bHQgRXh0ZW5zaW9uPSJ4bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNh' +
  'dGlvbi94bWwiLz48RGVmYXVsdCBFeHRlbnNpb249ImJpbiIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5tcy1leGNl' +
  'bC5zaGVldC5iaW5hcnkubWFjcm9FbmFibGVkLm1haW4iLz48RGVmYXVsdCBFeHRlbnNpb249InZtbCIgQ29udGVudFR5cGU9' +
  'ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC52bWxEcmF3aW5nIi8+PERlZmF1bHQgRXh0' +
  'ZW5zaW9uPSJkYXRhIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50' +
  'Lm1vZGVsK2RhdGEiLz48RGVmYXVsdCBFeHRlbnNpb249ImJtcCIgQ29udGVudFR5cGU9ImltYWdlL2JtcCIvPjxEZWZhdWx0' +
  'IEV4dGVuc2lvbj0icG5nIiBDb250ZW50VHlwZT0iaW1hZ2UvcG5nIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJnaWYiIENvbnRl' +
  'bnRUeXBlPSJpbWFnZS9naWYiLz48RGVmYXVsdCBFeHRlbnNpb249ImVtZiIgQ29udGVudFR5cGU9ImltYWdlL3gtZW1mIi8+' +
  'PERlZmF1bHQgRXh0ZW5zaW9uPSJ3bWYiIENvbnRlbnRUeXBlPSJpbWFnZS94LXdtZiIvPjxEZWZhdWx0IEV4dGVuc2lvbj0i' +
  'anBnIiBDb250ZW50VHlwZT0iaW1hZ2UvanBlZyIvPjxEZWZhdWx0IEV4dGVuc2lvbj0ianBlZyIgQ29udGVudFR5cGU9Imlt' +
  'YWdlL2pwZWciLz48RGVmYXVsdCBFeHRlbnNpb249InRpZiIgQ29udGVudFR5cGU9ImltYWdlL3RpZmYiLz48RGVmYXVsdCBF' +
  'eHRlbnNpb249InRpZmYiIENvbnRlbnRUeXBlPSJpbWFnZS90aWZmIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJwZGYiIENvbnRl' +
  'bnRUeXBlPSJhcHBsaWNhdGlvbi9wZGYiLz48RGVmYXVsdCBFeHRlbnNpb249InJlbHMiIENvbnRlbnRUeXBlPSJhcHBsaWNh' +
  'dGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5yZWxhdGlvbnNoaXBzK3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0i' +
  'L3hsL3dvcmtib29rLnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1' +
  'bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0Lm1haW4reG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIveGwvd29ya3NoZWV0cy9z' +
  'aGVldDEueG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LnNw' +
  'cmVhZHNoZWV0bWwud29ya3NoZWV0K3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0iL3hsL3RoZW1lL3RoZW1lMS54bWwiIENv' +
  'bnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQudGhlbWUreG1sIi8+PE92' +
  'ZXJyaWRlIFBhcnROYW1lPSIveGwvc2hhcmVkU3RyaW5ncy54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3Bl' +
  'bnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGFyZWRTdHJpbmdzK3htbCIvPjxPdmVycmlkZSBQ' +
  'YXJ0TmFtZT0iL3hsL3N0eWxlcy54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2Zm' +
  'aWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zdHlsZXMreG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIvZG9jUHJvcHMvY29y' +
  'ZS54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5jb3JlLXByb3BlcnRp' +
  'ZXMreG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIvZG9jUHJvcHMvYXBwLnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9u' +
  'L3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC5leHRlbmRlZC1wcm9wZXJ0aWVzK3htbCIvPjxPdmVycmlkZSBQ' +
  'YXJ0TmFtZT0iL3hsL21ldGFkYXRhLnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1v' +
  'ZmZpY2Vkb2N1bWVudC5zcHJlYWRzaGVldG1sLnNoZWV0TWV0YWRhdGEreG1sIi8+PC9UeXBlcz5QSwECAAAUAAAAAAAAAAAA' +
  'Qm/3BUIDAABCAwAAGgAAAAAAAAAAAAAAAAAAAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECAAAUAAAAAAAAAAAA' +
  'MA+Ia94dAADeHQAAEwAAAAAAAAAAAAAAAAB6AwAAeGwvdGhlbWUvdGhlbWUxLnhtbFBLAQIAABQAAAAAAAAAAABV9ASUWgQA' +
  'AFoEAAANAAAAAAAAAAAAAAAAAIkhAAB4bC9zdHlsZXMueG1sUEsBAgAAFAAAAAAAAAAAAJyJbhf/AgAA/wIAABgAAAAAAAAA' +
  'AAAAAAAADiYAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLAQIAABQAAAAAAAAAAABggACBiAMAAIgDAAAPAAAAAAAAAAAA' +
  'AAAAAEMpAAB4bC9tZXRhZGF0YS54bWxQSwECAAAUAAAAAAAAAAAAKdTe+kMBAABDAQAADwAAAAAAAAAAAAAAAAD4LAAAeGwv' +
  'd29ya2Jvb2sueG1sUEsBAgAAFAAAAAAAAAAAAJ7HzlgpAQAAKQEAABQAAAAAAAAAAAAAAAAAaC4AAHhsL3NoYXJlZFN0cmlu' +
  'Z3MueG1sUEsBAgAAFAAAAAAAAAAAAEpqEflMAgAATAIAAAsAAAAAAAAAAAAAAAAAwy8AAF9yZWxzLy5yZWxzUEsBAgAAFAAA' +
  'AAAAAAAAALAcc8ozAgAAMwIAABAAAAAAAAAAAAAAAAAAODIAAGRvY1Byb3BzL2FwcC54bWxQSwECAAAUAAAAAAAAAAAA1pJ8' +
  'EVoBAABaAQAAEQAAAAAAAAAAAAAAAACZNAAAZG9jUHJvcHMvY29yZS54bWxQSwECAAAUAAAAAAAAAAAAdnmU6p0IAACdCAAA' +
  'EwAAAAAAAAAAAAAAAAAiNgAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLBQYAAAAACwALAL0CAADwPgAAAAA=',
);
const PDF = deB64(
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5' +
  'cGUgL1BhZ2VzIC9LaWRzIFs0IDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5' +
  'cGUgL1R5cGUxIC9CYXNlRm9udCAvQ291cmllciAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNCAwIG9i' +
  'ago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDU5NSA4NDJdIC9SZXNvdXJjZXMgPDwgL0Zv' +
  'bnQgPDwgL0YxIDMgMCBSID4+ID4+IC9Db250ZW50cyA1IDAgUiA+PgplbmRvYmoKNSAwIG9iago8PCAvTGVuZ3RoIDc1MCA+' +
  'PgpzdHJlYW0KQlQKL0YxIDkuNSBUZgoxMi41IFRMCjUwIDc5MiBUZAooUGFuYWwgtyBpbmZvcm1lIGVzdHJ1Y3R1cmFkbyAj' +
  'MzIpIFRqIFQqCigpIFRqIFQqCih7KSBUaiBUKgooICAicHVlcnRvcyI6IFspIFRqIFQqCiggICAgeykgVGogVCoKKCAgICAg' +
  'ICJhZ2VudGUiOiAibGludCIsKSBUaiBUKgooICAgICAgInB1ZXJ0byI6IDg3ODksKSBUaiBUKgooICAgICAgImNvc3RvIjog' +
  'IjAuMDMgTU9OIikgVGogVCoKKCAgICB9LCkgVGogVCoKKCAgICB7KSBUaiBUKgooICAgICAgImFnZW50ZSI6ICJwYXJzZSIs' +
  'KSBUaiBUKgooICAgICAgInB1ZXJ0byI6IDg3OTAsKSBUaiBUKgooICAgICAgImNvc3RvIjogIjAuMDEgTU9OIikgVGogVCoK' +
  'KCAgICB9LCkgVGogVCoKKCAgICB7KSBUaiBUKgooICAgICAgImFnZW50ZSI6ICJzcGVjIiwpIFRqIFQqCiggICAgICAicHVl' +
  'cnRvIjogODc5MSwpIFRqIFQqCiggICAgICAiY29zdG8iOiAiMTAwIFBBTkFMIikgVGogVCoKKCAgICB9KSBUaiBUKgooICBd' +
  'LCkgVGogVCoKKCAgIl9ub3RhcyI6ICJFbCB1c3VhcmlvIHRhbWJp6W4gcGlkafMgdW4gaW5mb3JtZSBlbiBQREYsIHBlcm8g' +
  'bm8gc2UgcHJvcG9yY2lvbvMgbeFzIGluKSBUaiBUKgooICBmb3JtYWNp824gc29icmUgc3UgZXN0cnVjdHVyYSBvIGNvbnRl' +
  'bmlkbywgcG9yIGxvIHF1ZSBubyBwdWVkbyBnZW5lcmFybG8uIFNlIGRldnVlbHYpIFRqIFQqCiggIGUgc29sbyBsYSBlc3Ry' +
  'dWN0dXJhIHNvbGljaXRhZGEuIikgVGogVCoKKH0pIFRqIFQqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAw' +
  'MDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBu' +
  'IAowMDAwMDAwMjEwIDAwMDAwIG4gCjAwMDAwMDAzMzYgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBS' +
  'ID4+CnN0YXJ0eHJlZgoxMTM3CiUlRU9GCg==',
);

console.log('\n── Reconocer por los BYTES, no por el nombre ──\n');

check('un PNG es un PNG', tipoDe(PNG) === 'png');
check('un PDF es un PDF', tipoDe(PDF) === 'pdf', tipoDe(PDF));
check('un .docx se ve como ZIP', tipoDe(DOCX) === 'zip');
check('el texto suelto no es nada de eso', tipoDe(bytes('hola mundo')) === 'otro');

console.log('\n── Imagenes: se ENSEnAN, no se describen ──\n');

const conImagen = await leerAdjuntos([{ name: 'logo.png', mime: 'image/png', bytes: PNG }]);
check('la imagen sale aparte, para el modelo', conImagen.imagenes.length === 1);
check('con su mime correcto', conImagen.imagenes[0]?.mime === 'image/png');
check('y en el texto se avisa de que va adjunta', conImagen.texto.includes('logo.png'));

console.log('\n── Word ──\n');

const docx = textoDeDocx(DOCX);
check('se saca el texto de un .docx', !!docx && docx.includes('Contrato de servicios'), String(docx));
check('y las cifras que trae', !!docx && docx.includes('500'));
check('una frase partida por Word no se rompe', !!docx && docx.includes('contratante'), String(docx));
check('los parrafos siguen siendo parrafos', !!docx && docx.split('\n').filter(Boolean).length >= 3);

console.log('\n── Carpetas ──\n');

const zip = await leerAdjuntos([{ name: 'proyecto.zip', bytes: ZIP }]);
check('se leen los archivos de texto de dentro', zip.texto.includes('8789'), zip.texto.slice(0, 120));
check('con su ruta, para saber cual es cual', zip.texto.includes('src/util/fecha.ts'));
check('el binario de dentro se NOMBRA en vez de colarse', zip.texto.includes('logo.bin'));

console.log('\n── Excel ──\n');

const xlsx = textoDeXlsx(XLSX);
// Las celdas de texto de un .xlsx no guardan el texto: guardan un ÍNDICE a
// sharedStrings.xml. Sin resolver esa tabla, una hoja de nombres se lee como
// una lista de números.
check('se resuelve la tabla de cadenas compartidas', !!xlsx && xlsx.includes('Auditoría'), String(xlsx));
check('los números salen', !!xlsx && xlsx.includes('15000'));
check('las columnas van separadas por tabulador', !!xlsx && xlsx.split('\n')[0]!.includes('\t'), String(xlsx));
check('una fila vacía no aparece', !!xlsx && !xlsx.includes('\n\n'));

const comoAdjunto = await leerAdjuntos([{ name: 'factura.xlsx', bytes: XLSX }]);
check('y entra como hoja de cálculo, no como carpeta', comoAdjunto.texto.includes('Hoja de cálculo'), comoAdjunto.texto.slice(0, 90));

console.log('\n── PDF ──\n');

const pdf = await leerAdjuntos([{ name: 'informe.pdf', bytes: PDF }]);
check('se extrae el texto de un PDF', pdf.texto.includes('lint'), pdf.texto.slice(0, 140));
check('y no queda como ilegible', !pdf.texto.includes('no se pudo sacar texto'));

console.log('\n── Lo que NO se puede abrir se dice ──\n');

const raro = await leerAdjuntos([{ name: 'algo.bin', mime: 'application/x-cosa', bytes: new Uint8Array([0, 1, 2, 3, 200, 201]) }]);
check('un binario cualquiera no se ignora', raro.texto.includes('algo.bin'));
check('se dice que no se pudo abrir', raro.texto.includes('no puede abrirlo'), raro.texto);
check('y se pide que lo diga en la respuesta', raro.texto.includes('en vez de ignorarlo'));

const pdfRoto = await leerAdjuntos([{ name: 'roto.pdf', bytes: bytes('%PDF-1.4 y aqui basura') }]);
check('un PDF ilegible se declara ilegible', pdfRoto.texto.includes('no se pudo sacar texto'), pdfRoto.texto);

console.log('\n── Texto normal, que es el caso de siempre ──\n');

const txt = await leerAdjuntos([{ name: 'notas.md', bytes: bytes('# Notas\n\nnada raro') }]);
check('se lee tal cual', txt.texto.includes('nada raro'));
check('un binario que decodifica como UTF-8 se rechaza igual', comoTexto(new Uint8Array([0x01, 0x02])) === null);
check('sin adjuntos, texto vacio', (await leerAdjuntos([])).texto === '');

console.log('\n── El coste, que lo paga el agente ──\n');

const gordo = await leerAdjuntos([
  { name: 'a.txt', bytes: bytes('a'.repeat(50_000)) },
  { name: 'b.txt', bytes: bytes('b'.repeat(50_000)) },
  { name: 'c.txt', bytes: bytes('c'.repeat(50_000)) },
]);
check('el total se acota', gordo.texto.length < 30_000, `${gordo.texto.length} caracteres`);
check('y se avisa de que se recorto', gordo.texto.includes('recortado'));

console.log(
  fallos === 0
    ? '\n✅ Imagenes, Word, PDF y carpetas entran; y lo que no se puede abrir se dice\n'
    : `\n❌ ${fallos} comprobacion(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
