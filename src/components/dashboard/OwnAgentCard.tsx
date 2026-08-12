/**
 * Panal — Card del agente propio, 100% on-chain (PanalRegistry).
 * Si la wallet es agente: datos reales (nombre desde metadataURI, precio,
 * estado activo), "Editar precio" firma updatePrice(parseEther) y el switch
 * firma setActive(bool) — ambos con el patrón de escritura obligatorio.
 * Si no es agente: CTA que abre RegisterAgentDialog (prop onRegister).
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, ExternalLink, Loader2, Plus, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatEther, parseEther } from 'viem';
import HexAvatar from '@/components/HexAvatar';
import EditProfileDialog from '@/components/dashboard/EditProfileDialog';
import { parseAgentMetadata } from '@/lib/agentMetadata';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { useMyAgentProfile } from '@/hooks/useMyAgentProfile';
import { useContractAction } from '@/hooks/useContractAction';
import {
  EXPLORER_TX,
  NATIVE_CURRENCY,
  PANAL_REGISTRY_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  V2_ENABLED,
  currencySymbol,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi } from '@/contracts/abis';
import { formatMonEs, formatRatingEs } from './data';

/** metadataURI "Nombre · descripción · skills" → nombre. */
function agentName(metadataURI: string, fallback: string): string {
  const first = metadataURI.split('·')[0]?.trim();
  return first || fallback;
}

export default function OwnAgentCard({ onRegister }: { onRegister: () => void }) {
  const { t } = useTranslation();
  const { address, addressShort } = useWallet();
  const profile = useMyAgentProfile();
  const action = useContractAction({ onMined: () => profile.refetch() });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  /** Moneda elegida en el diálogo de edición (v2: updatePrice la lleva). */
  const [editCurrency, setEditCurrency] = useState<'MON' | '$PANAL'>('MON');

  const priceStr = priceInput.replace(',', '.').trim();
  const priceValid = /^\d+(\.\d{1,18})?$/.test(priceStr) && Number(priceStr) > 0;

  const agent = profile.agent;
  /**
   * URL del bot declarada en el metadata (`bot:<url>`), si existe.
   *
   * Este useMemo va AQUÍ, antes del return de abajo, y no puede bajar: un hook
   * detrás de un return condicional cambia el número de hooks entre renders y
   * React tira el árbol entero. Estaba escrito más abajo y no se notaba porque
   * el return no llegaba a ejecutarse nunca — getAgent no revertía para quien
   * no era agente, así que isAgent salía true para todo el mundo. Al arreglar
   * eso, el return empezó a saltar y el panel entero se quedó en negro.
   */
  const botUrl = useMemo(
    () => (agent ? parseAgentMetadata(agent.metadataURI).botUrl : ''),
    [agent],
  );

  /* ── No es agente → CTA de registro real ─────────────────────────────── */
  if (!profile.loading && !profile.isAgent) {
    return (
      <motion.div
        whileHover={{ y: -4 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="flex h-full flex-col items-start gap-4 rounded-2xl border border-dashed border-line bg-paper p-6 shadow-card md:col-span-2"
      >
        <h3 className="font-display text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">
          {t('ownAgent.ctaTitle')}
        </h3>
        <p className="max-w-lg text-[0.875rem] leading-relaxed text-ink-2">{t('ownAgent.ctaDesc')}</p>
        <button
          type="button"
          onClick={onRegister}
          className="mt-auto inline-flex items-center gap-1.5 rounded-full bg-honey px-4 py-2 text-[0.875rem] font-semibold text-[#1B1814] transition-colors hover:bg-honey-deep"
        >
          <Plus size={15} />
          {t('dash.registerAgent')}
        </button>
      </motion.div>
    );
  }

  const rep = profile.reputation;
  const name = agent
    ? agentName(agent.metadataURI, addressShort ?? t('ownAgent.fallbackName'))
    : (addressShort ?? '…');
  const active = agent?.active ?? false;
  const rating =
    rep.ratingCount > 0n ? Number(rep.ratingSum) / Number(rep.ratingCount) : null;

  const toggleActive = (next: boolean) => {
    void action.run({
      address: V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS,
      abi: V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi,
      functionName: 'setActive',
      args: [next],
    });
  };

  const savePrice = () => {
    if (!priceValid) return;
    // v2: updatePrice lleva la moneda del agente; v1: solo el precio.
    void action.run(
      V2_ENABLED
        ? {
            address: PANAL_REGISTRY_V2_ADDRESS,
            abi: panalRegistryV2Abi,
            functionName: 'updatePrice',
            args: [parseEther(priceStr), editCurrency === '$PANAL' ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY],
          }
        : {
            address: PANAL_REGISTRY_ADDRESS,
            abi: panalRegistryAbi,
            functionName: 'updatePrice',
            args: [parseEther(priceStr)],
          },
    );
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={cn(
        'flex h-full flex-col gap-5 rounded-2xl border border-line bg-paper p-5 shadow-card transition-[opacity,border-color,box-shadow] duration-300 hover:border-honey hover:shadow-card-hover md:col-span-2',
        !active && 'opacity-70',
      )}
    >
      {/* Fila: avatar + nombre + chips + switch */}
      <div className="flex items-start gap-3">
        <HexAvatar seed={address ?? name} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">
            {profile.loading ? '…' : name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-sand px-2.5 py-0.5 font-mono text-[0.75rem] text-ink-2">
              {addressShort}
            </span>
            {agent && (
              <span className="rounded-full bg-honey-soft px-2.5 py-0.5 font-mono text-[0.75rem] text-honey-deep">
                {agent.currency && agent.currency !== NATIVE_CURRENCY
                  ? `${formatMonEs(Number(formatEther(agent.pricePerTask)))} ${currencySymbol(agent.currency)}/task`
                  : t('common.monPerTask', { price: formatMonEs(Number(formatEther(agent.pricePerTask))) })}
              </span>
            )}
            {botUrl && (
              <a
                href={botUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={t('metadata.botAria', { name })}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-0.5 font-mono text-[0.75rem] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
              >
                <Bot size={11} aria-hidden />
                {t('metadata.botLabel')}
              </a>
            )}
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2">
          <span className={cn('text-[0.75rem] font-medium', active ? 'text-olive' : 'text-ink-3')}>
            {active ? t('ownAgent.active') : t('ownAgent.pausedLabel')}
          </span>
          <Switch
            checked={active}
            disabled={!agent || action.busy}
            onCheckedChange={toggleActive}
            aria-label={`${active ? t('ownAgent.pause') : t('ownAgent.activate')} ${name}`}
            className="data-[state=checked]:bg-honey"
          />
        </label>
      </div>

      {/* Métricas reales (PanalReputation) */}
      <div className="grid grid-cols-3 gap-3 border-y border-line py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">{t('dash.kpi.completed')}</span>
          <span className="font-mono text-[0.875rem] font-medium text-ink">{rep.tasksCompleted.toString()}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">{t('dash.kpi.incomeTotal')}</span>
          <span className="font-mono text-[0.875rem] font-medium text-ink">{formatMonEs(Number(formatEther(rep.totalEarned)))} {currencySymbol(agent?.currency ?? NATIVE_CURRENCY)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">Rating</span>
          <span className="font-mono text-[0.875rem] font-medium text-ink">
            {rating !== null ? `${formatRatingEs(rating)} ★` : '—'}
          </span>
        </div>
      </div>

      {/* Footer de acciones */}
      <div className="mt-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPriceInput(agent ? formatEther(agent.pricePerTask) : '');
            setEditCurrency(agent?.currency === PANAL_TOKEN_ADDRESS ? '$PANAL' : 'MON');
            setDialogOpen(true);
          }}
          disabled={!agent}
          className="rounded-full border border-line bg-transparent px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-40"
        >
          {t('ownAgent.editPrice')}
        </button>
        {V2_ENABLED ? (
          <button
            type="button"
            onClick={() => setProfileDialogOpen(true)}
            disabled={!agent}
            className="rounded-full border border-line bg-transparent px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-40"
          >
            {t('ownAgent.editProfile.button')}
          </button>
        ) : (
          <span className="text-[0.75rem] leading-snug text-ink-3">
            {t('ownAgent.editProfile.v2Only')}
          </span>
        )}
        {action.busy && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[0.75rem] text-ink-3">
            <Loader2 size={13} className="animate-spin" aria-hidden />
            {action.signing ? t('hire.step3.signing') : t('hire.step3.confirming')}
          </span>
        )}
        {action.txHash && !action.busy && action.mined && (
          <a
            href={EXPLORER_TX(action.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 font-mono text-[0.75rem] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
          >
            {t('hire.step3.viewTx')}
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {/* Dialog de edición de perfil (tx real updateMetadata, solo v2) */}
      {agent && V2_ENABLED && (
        <EditProfileDialog
          open={profileDialogOpen}
          onOpenChange={setProfileDialogOpen}
          metadataURI={agent.metadataURI}
          agentName={name}
          onMined={() => profile.refetch()}
        />
      )}

      {/* Dialog de edición de precio (tx real updatePrice) */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !action.busy && setDialogOpen(o)}>
        <DialogContent className="border-line bg-paper sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">{t('ownAgent.editTitle', { name })}</DialogTitle>
            <DialogDescription className="text-ink-2">{t('ownAgent.editDescReal')}</DialogDescription>
          </DialogHeader>

          {action.mined && action.txHash ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <p className="font-display text-ink">{t('dashReal.txConfirmed')}</p>
              <TxHash hash={action.txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="w-full rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
              >
                {t('common.close')}
              </button>
            </div>
          ) : action.txHash ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <Loader2 size={28} className="animate-spin text-honey-deep" aria-hidden />
              <p className="text-[0.875rem] font-medium text-ink">{t('hire.step3.confirming')}</p>
              <a
                href={EXPLORER_TX(action.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
              >
                {t('hire.step3.viewTx')}
                <ExternalLink size={13} />
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-2">
              {V2_ENABLED && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.8125rem] font-medium text-ink-2">{t('register.currencyLabel')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(['MON', '$PANAL'] as const).map((cur) => (
                      <button
                        key={cur}
                        type="button"
                        onClick={() => setEditCurrency(cur)}
                        className={cn(
                          'rounded-full border px-3 py-2 text-[0.8125rem] font-medium transition-colors',
                          editCurrency === cur
                            ? 'border-honey bg-honey-soft text-honey-deep'
                            : 'border-line bg-transparent text-ink-2 hover:border-honey/50 hover:text-ink',
                        )}
                      >
                        {cur === 'MON' ? t('register.currencyNative') : t('register.currencyToken')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <input
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.01"
                  aria-label={t('ownAgent.priceAria')}
                  className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 font-mono text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                />
                <span className="shrink-0 font-mono text-[0.8125rem] text-ink-2">{editCurrency === '$PANAL' ? t('common.tokenTask') : t('common.monTask')}</span>
              </div>
              {priceStr.length > 0 && !priceValid && (
                <p className="flex items-center gap-1.5 text-[0.75rem] text-terra">
                  <TriangleAlert size={12} aria-hidden />
                  {t('wallet.invalidAmount')}
                </p>
              )}
              <button
                type="button"
                onClick={savePrice}
                disabled={!priceValid || action.busy}
                className="btn-monad inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-40"
              >
                {action.signing && <Loader2 size={15} className="animate-spin" aria-hidden />}
                {action.signing ? t('hire.step3.signing') : t('ownAgent.savePrice')}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
