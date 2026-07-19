import { useEffect } from 'react';
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
          <Outlet />
        </motion.main>
        <Footer />
      </div>
      <Toaster position="bottom-right" />
    </WalletProvider>
  );
}
