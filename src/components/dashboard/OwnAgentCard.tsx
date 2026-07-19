/**
 * AgentHive — Card de agente propio (dashboard.md S4).
 * Switch Activo/Pausado (atenua la card + toast), métricas mono, mini área 14d,
 * edición de precio con tx simulada (1.2s, spinner hexagonal) y menú de acciones.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, Coins, Hexagon, MoreHorizontal, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import HexAvatar from '@/components/HexAvatar';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CATEGORY_LABELS, formatInt, formatMon } from '@/data/agents';
import { randomTxHash, truncateHash } from '@/data/events';
import { MiniAreaChart } from './charts';
import type { OwnAgent } from './data';
import { formatMonEs, formatRatingEs } from './data';

/** Spinner hexagonal para el guardado de precio (tx simulada). */
function HexSpinner({ size = 44 }: { size?: number }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <Hexagon size={size} className="animate-spin-slow text-honey" strokeWidth={1.5} />
      <Hexagon size={size * 0.45} className="absolute inset-0 m-auto fill-honey-soft text-honey-deep" strokeWidth={1.5} />
    </span>
  );
}

export default function OwnAgentCard({ agent, className }: { agent: OwnAgent; className?: string }) {
  const [active, setActive] = useState(true);
  const [price, setPrice] = useState(agent.pricePerTask);
  const [draft, setDraft] = useState(agent.pricePerTask);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggleActive = (next: boolean) => {
    setActive(next);
    if (!next) {
      toast(`${agent.name} pausado — no recibirá tareas nuevas`, {
        icon: <PauseCircle size={15} className="text-honey-deep" />,
      });
    } else {
      toast(`${agent.name} activo de nuevo`, {
        icon: <PlayCircle size={15} className="text-olive" />,
      });
    }
  };

  const savePrice = () => {
    setSaving(true);
    window.setTimeout(() => {
      const tx = randomTxHash();
      setPrice(draft);
      setSaving(false);
      setDialogOpen(false);
      toast(`Precio actualizado: tx ${truncateHash(tx)}`, {
        icon: <Hexagon size={14} className="fill-honey-soft text-honey-deep" />,
      });
    }, 1200);
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={cn(
        'flex h-full flex-col gap-5 rounded-2xl border border-line bg-paper p-5 shadow-card transition-[opacity,border-color,box-shadow] duration-300 hover:border-honey hover:shadow-card-hover',
        !active && 'opacity-55',
        className,
      )}
    >
      {/* Fila: avatar + nombre + chip + switch */}
      <div className="flex items-start gap-3">
        <HexAvatar seed={agent.wallet} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">
            {agent.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-honey-soft px-2.5 py-0.5 text-[0.75rem] font-medium text-honey-deep">
              {CATEGORY_LABELS[agent.category]}
            </span>
            <span className="rounded-full bg-sand px-2.5 py-0.5 font-mono text-[0.75rem] text-ink-2">
              {formatMon(price)} MON/tarea
            </span>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2">
          <span className={cn('text-[0.75rem] font-medium', active ? 'text-olive' : 'text-ink-3')}>
            {active ? 'Activo' : 'Pausado'}
          </span>
          <Switch
            checked={active}
            onCheckedChange={toggleActive}
            aria-label={`${active ? 'Pausar' : 'Activar'} ${agent.name}`}
            className="data-[state=checked]:bg-honey"
          />
        </label>
      </div>

      {/* Métricas mono en 3 columnas */}
      <div className="grid grid-cols-3 gap-3 border-y border-line py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">Hoy</span>
          <span className="font-mono text-[0.875rem] font-medium text-ink">{formatMonEs(agent.todayMon)} MON</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">Tareas 30d</span>
          <span className="font-mono text-[0.875rem] font-medium text-ink">{formatInt(agent.tasks30d)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">Rating</span>
          <span className="font-mono text-[0.875rem] font-medium text-ink">{formatRatingEs(agent.rating)} ★</span>
        </div>
      </div>

      {/* Mini área de ingresos 14d */}
      <div>
        <span className="mb-1 block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">
          Ingresos · 14 días
        </span>
        <MiniAreaChart data={agent.trend14d} />
      </div>

      {/* Footer de acciones */}
      <div className="mt-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft(price);
            setDialogOpen(true);
          }}
          className="rounded-full bg-ink px-3.5 py-1.5 text-[0.8125rem] font-medium text-paper transition-colors hover:bg-honey-deep"
        >
          Editar precio
        </button>
        <Link
          to={`/agente/${agent.id}`}
          className="rounded-full border border-line px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          Ver perfil público
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Más acciones de ${agent.name}`}
              className="ml-auto rounded-full p-2 text-ink-3 transition-colors hover:bg-cream hover:text-ink"
            >
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-line bg-paper">
            <DropdownMenuItem onSelect={() => toggleActive(!active)} className="gap-2 text-ink-2">
              {active ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
              {active ? 'Pausar' : 'Reanudar'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => toast(`Estadísticas de ${agent.name}`, { description: 'Panel avanzado disponible en la Fase 2.' })}
              className="gap-2 text-ink-2"
            >
              <BarChart3 size={14} /> Estadísticas
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                toast(`Retiro de ganancias de ${agent.name} iniciado`, {
                  icon: <Coins size={14} className="text-honey-deep" />,
                  description: `${formatMonEs(agent.todayMon)} MON → tu wallet (simulado).`,
                })
              }
              className="gap-2 text-ink-2"
            >
              <Coins size={14} /> Retirar ganancias
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Dialog de edición de precio */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !saving && setDialogOpen(o)}>
        <DialogContent className="border-line bg-paper sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">Editar precio — {agent.name}</DialogTitle>
            <DialogDescription className="text-ink-2">
              El nuevo precio se publica en AgentRegistry con una transacción (simulada).
            </DialogDescription>
          </DialogHeader>

          {saving ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <HexSpinner />
              <p className="font-mono text-[0.8125rem] text-ink-2">Firmando transacción…</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5 py-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[2rem] font-medium leading-none text-ink">
                  {formatMon(draft, 4)}
                </span>
                <span className="text-[0.875rem] text-ink-3">MON/tarea</span>
              </div>
              <Slider
                value={[draft]}
                min={0.001}
                max={0.05}
                step={0.001}
                onValueChange={([v]) => setDraft(v)}
                aria-label="Precio por tarea en MON"
              />
              <div className="flex justify-between font-mono text-[0.6875rem] text-ink-3">
                <span>0.001</span>
                <span>0.050</span>
              </div>
              <button
                type="button"
                onClick={savePrice}
                className="rounded-full bg-honey px-4 py-2.5 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
              >
                Guardar precio
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
