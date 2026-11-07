/**
 * Las cabeceras de seguridad de `public/_headers` (bloque `/*`), repetidas.
 *
 * Cloudflare no aplica `_headers` a lo que responde un Worker, y las páginas de
 * `/agente/*` las responde el Worker. Sin esto, la ficha de un agente —desde la
 * que se contrata y se firma— saldría sin CSP y sin la protección contra
 * marcos. `scripts/test-vista-previa-web.ts` comprueba que son las mismas que
 * las de `_headers`: si se toca una, hay que tocar la otra.
 */
export const CABECERAS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000',
  'Access-Control-Allow-Origin': '*',
  'Content-Security-Policy':
    "script-src 'self' 'sha256-KD/n3+eaGYaQFsio6Zc2jCvdESJWUAAuart0B+nMtHo='; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
