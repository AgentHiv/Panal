import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import LiveDot from '@/components/LiveDot';
import HexAvatar from '@/components/HexAvatar';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { to: '/mercado', label: 'Mercado' },
  { to: '/en-vivo', label: 'En Vivo', live: true },
  { to: '/protocolo', label: 'Protocolo' },
  { to: '/dashboard', label: 'Dashboard' },
];

/** Navbar fija de todas las páginas (design.md §5) — sticky top-0 z-50, en flujo normal. */
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { connected, connecting, addressShort, address, connect, disconnect, wrongNetwork, switchToMonad } = useWallet();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 h-16 transition-colors duration-300 md:h-[72px]',
        scrolled ? 'border-b border-line bg-paper/80 backdrop-blur-md' : 'border-b border-transparent bg-paper/0',
      )}
    >
      <div className="container-hive flex h-full items-center justify-between gap-4">
        {/* Izquierda: isotipo + wordmark */}
        <Link to="/" className="flex items-center gap-2.5" aria-label="Panal — inicio">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          <span className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-ink">Panal</span>
        </Link>

        {/* Centro: navegación (desktop) */}
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Principal">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'relative py-2 text-[0.875rem] font-medium tracking-[0.01em] transition-colors',
                  isActive ? 'text-ink' : 'text-ink-2 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="flex items-center gap-1.5">
                    {link.label}
                    {link.live && <LiveDot variant="honey" className="h-1.5 w-1.5" />}
                  </span>
                  {isActive && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full bg-honey"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Derecha: chip de red + wallet */}
        <div className="flex items-center gap-3">
          {connected && wrongNetwork ? (
            <button
              type="button"
              onClick={switchToMonad}
              title="Cambiar a Monad testnet"
              className="hidden items-center gap-2 rounded-full border border-terra/40 bg-terra/10 px-3 py-1.5 font-mono text-[12px] font-medium text-terra transition-colors hover:bg-terra/20 md:inline-flex"
            >
              <LiveDot variant="terra" />
              Red incorrecta — cambiar a Monad
            </button>
          ) : (
            <span className="hidden items-center gap-2 rounded-full border border-line bg-cream px-3 py-1.5 font-mono text-[12px] text-ink-2 md:inline-flex">
              <LiveDot variant="olive" />
              Monad testnet · 10143
            </span>
          )}

          {connected ? (
            <button
              type="button"
              onClick={disconnect}
              title="Desconectar wallet"
              className="hidden items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[12px] text-ink transition-colors hover:border-honey sm:flex"
            >
              <HexAvatar seed={address ?? 'wallet'} size={18} />
              {addressShort}
            </button>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={connecting}
              className="hidden items-center gap-2 rounded-full bg-ink px-4 py-2 text-[0.875rem] font-medium text-paper transition-colors hover:bg-honey-deep disabled:opacity-70 sm:inline-flex"
            >
              {connecting ? 'Conectando…' : 'Conectar wallet'}
            </button>
          )}

          {/* Móvil: hamburguesa → Sheet lateral */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink lg:hidden"
                aria-label="Abrir menú"
              >
                <Menu size={18} />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[320px] border-line bg-paper p-0">
              <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
              <div className="flex h-full flex-col px-8 pb-8 pt-16">
                <nav className="flex flex-col gap-5" aria-label="Móvil">
                  {NAV_LINKS.map((link, i) => (
                    <motion.div
                      key={link.to}
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.06 * i + 0.1, duration: 0.3 }}
                    >
                      <Link
                        to={link.to}
                        onClick={() => setOpen(false)}
                        className="display-m flex items-center gap-3 text-ink transition-colors hover:text-honey-deep"
                      >
                        {link.label}
                        {link.live && <LiveDot variant="honey" />}
                      </Link>
                    </motion.div>
                  ))}
                </nav>
                <div className="mt-auto flex flex-col gap-4">
                  {connected && wrongNetwork ? (
                    <button
                      type="button"
                      onClick={switchToMonad}
                      className="inline-flex w-fit items-center gap-2 rounded-full border border-terra/40 bg-terra/10 px-3 py-1.5 font-mono text-[12px] font-medium text-terra"
                    >
                      <LiveDot variant="terra" />
                      Red incorrecta — cambiar a Monad
                    </button>
                  ) : (
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-cream px-3 py-1.5 font-mono text-[12px] text-ink-2">
                      <LiveDot variant="olive" />
                      Monad testnet · 10143
                    </span>
                  )}
                  {connected ? (
                    <button
                      type="button"
                      onClick={disconnect}
                      className="flex items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-3 font-mono text-[12px] text-ink"
                    >
                      <HexAvatar seed={address ?? 'wallet'} size={18} />
                      {addressShort}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={connect}
                      className="rounded-full bg-ink px-4 py-3 text-[0.875rem] font-medium text-paper transition-colors hover:bg-honey-deep"
                    >
                      {connecting ? 'Conectando…' : 'Conectar wallet'}
                    </button>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
