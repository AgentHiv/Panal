import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

/**
 * SEO: inyecta la URL pública del sitio (%SITE_URL% en index.html) y emite
 * robots.txt + sitemap.xml en el build. Configurar VITE_SITE_URL en Vercel.
 */
const SITE_URL = (process.env.VITE_SITE_URL ?? "https://panal.lat").replace(/\/$/, "");
const ROUTES = ["/", "/mercado", "/en-vivo", "/protocolo", "/dashboard"];

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
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), seoPlugin()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
