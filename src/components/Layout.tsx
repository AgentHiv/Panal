import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Cursor from '@/components/Cursor';
import WalletProvider from '@/components/WalletProvider';

gsap.registerPlugin(ScrollTrigger);

/**
 * Layout global: Lenis (lerp 0.09, desactivado con prefers-reduced-motion),
 * scroll-to-top instantáneo por ruta, transición fade+y12 (0.35s), grain overlay,
 * cursor personalizado y Toaster en esquina inferior derecha.
 */
/**
 * El hueco mientras llega el trozo de una página.
 *
 * Callado los primeros 400 ms: casi todos los trozos pesan menos de 80 kB y
 * llegan antes de eso, y enseñar un «cargando» que parpadea es peor que no
 * enseñar nada. Pasado ese rato, con mala señal, hay que decir algo — dejar la
 * zona en blanco sin explicación es exactamente lo que hacía la pantalla de
 * arranque antes de arreglarla.
 *
 * Alto de pantalla desde el principio para que el pie no suba y vuelva a bajar.
 */
function CargandoPagina() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="flex min-h-screen items-start justify-center pt-32" aria-hidden={!visible}>
      {visible && (
        <span className="flex items-center gap-2.5 text-[0.875rem] text-ink-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-honey" />
          Panal
        </span>
      )}
    </div>
  );
}

export default function Layout() {
  const location = useLocation();

  // Lenis en toda la app, sincronizado con ScrollTrigger
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  // scroll-to-top instantáneo al cambiar de ruta
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    ScrollTrigger.refresh();
  }, [location.pathname]);

  /*
   * La canónica y `og:url`, apuntando a la ruta que se está viendo.
   *
   * Esto es una SPA servida con una reescritura que manda TODO a
   * `index.html`, así que cada ruta llegaba con la canónica que hay escrita
   * ahí: `https://panal.lat/`. Es decir que /mercado, /tablon y el resto le
   * decían a Google «soy un duplicado de la portada, indexa esa». Con eso
   * puesto, meter rutas en el sitemap no servía de nada: el sitemap pide que
   * se indexen y la página lo desmiente, y gana la página.
   *
   * No sustituye a renderizar la etiqueta en el servidor —un rastreador que
   * no ejecute JavaScript sigue viendo la de la portada—, pero Googlebot sí
   * renderiza, que es de quien depende que el sitemap sirva para algo.
   */
  useEffect(() => {
    const url = `${window.location.origin}${location.pathname}`;

    const canonica = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonica) canonica.href = url;

    const og = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (og) og.content = url;
  }, [location.pathname]);

  return (
    <WalletProvider>
      <Cursor />
      {/* overlay global de textura de grano */}
      <div className="grain-overlay fixed inset-0 z-[90]" aria-hidden />
      <div className="flex min-h-[100dvh] flex-col bg-paper">
        <Navbar />
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex-1"
        >
          {/* Las páginas llegan en su propio trozo (ver `App.tsx`), así que
              aquí hace falta un límite. Va DENTRO del `main` y no envolviendo
              el layout entero: mientras la página viaja, la cabecera, el pie y
              el menú siguen ahí y se puede navegar a otro sitio. Envolviendo
              todo, cada cambio de ruta parpadearía el sitio entero.

              El hueco tiene alto de pantalla para que el pie no suba y vuelva
              a bajar: ese salto es lo único que se nota de partir por rutas. */}
          <Suspense fallback={<CargandoPagina />}>
            <Outlet />
          </Suspense>
        </motion.main>
        <Footer />
      </div>
      <Toaster position="bottom-right" />
    </WalletProvider>
  );
}
