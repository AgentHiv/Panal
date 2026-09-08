import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

/**
 * SEO: inyecta la URL pública del sitio (%SITE_URL% en index.html) y emite
 * robots.txt + sitemap.xml en el build. VITE_SITE_URL se configura en el panel
 * del servidor; sin ella se usa https://panal.lat.
 */
const SITE_URL = (process.env.VITE_SITE_URL ?? "https://panal.lat").replace(/\/$/, "");
/**
 * Solo las rutas que un desconocido puede leer enteras.
 *
 * `/archivo` y `/dashboard` NO estan aqui a proposito: las dos vuelven
 * temprano si no hay wallet conectada, asi que lo que ve un rastreador —que
 * nunca la tiene— es una pagina vacia. Pedir que la indexen es pedir que
 * indexen el vacio, y esas dos paginas compiten contra las que si tienen algo
 * que decir. Se siguen visitando por su enlace; no aparecen en el mapa.
 */
const ROUTES = [
  "/",
  "/mercado",
  "/tablon",
  "/crear-agente",
  "/en-vivo",
  "/protocolo",
  "/token",
  "/hoja-de-ruta",
  // La descarga de la app. Entra en el mapa porque es de las pocas paginas que
  // alguien busca por su cuenta —«panal apk», «panal android»— y porque es la
  // que hay que encontrar antes de instalar nada: si no aparece, se llega al
  // APK por un enlace de terceros, que es justo como se reparte una copia
  // manipulada.
  "/app",
];

function seoPlugin(): Plugin {
  return {
    name: "panal-seo",
    transformIndexHtml(html) {
      return html.replaceAll("%SITE_URL%", SITE_URL);
    },
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10);
      const urls = ROUTES.map(
        (r) =>
          `  <url><loc>${SITE_URL}${r}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${r === "/" ? "1.0" : "0.8"}</priority></url>`
      ).join("\n");
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });
    },
  };
}

// https://vite.dev/config/
function pesar(): Plugin {
  return {
    name: 'pesar',
    generateBundle(_o, bundle) {
      const agrupa = (id: string) => {
        const m = id.match(/node_modules\/(\.pnpm\/)?((@[^/]+\/)?[^/]+)/);
        return m ? m[2] : (id.match(/src\/[^/]+/) || ['(app)'])[0];
      };
      for (const [nombre, c] of Object.entries(bundle)) {
        if (c.type !== 'chunk') continue;
        const por: Record<string, number> = {};
        for (const [id, mod] of Object.entries(c.modules)) {
          const k = agrupa(id);
          por[k] = (por[k] || 0) + (mod as { renderedLength: number }).renderedLength;
        }
        const total = Object.values(por).reduce((a, b) => a + b, 0);
        console.log(`\n### ${nombre}  ${(total / 1024).toFixed(0)} kB`);
        Object.entries(por).sort((a, b) => b[1] - a[1]).slice(0, 18)
          .forEach(([k, v]) => { if (v > 8000) console.log(`   ${(v / 1024).toFixed(0).padStart(6)} kB  ${k}`); });
      }
    },
  };
}

export default defineConfig({
  base: '/',  // rutas absolutas: enlaces profundos (/agente/:id) en frío no rompen los assets
  plugins: [inspectAttr(), react(), seoPlugin(), pesar()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
