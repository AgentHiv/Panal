/**
 * Panal — AdminCard: administración del protocolo (solo visible si la wallet
 * conectada es el owner o el arbitrator actual del EscrowV2).
 *
 * Permite migrar el rol de árbitro al PanalMultisig 2-de-3 firmando con
 * MetaMask — la clave nunca toca una terminal.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { isAddress, type Address } from 'viem';
import { ShieldCheck, Loader2, ExternalLink, TriangleAlert } from 'lucide-react';
import { panalEscrowV2Abi } from '@/contracts/abis';
import {
  EXPLORER_ADDRESS,
  PANAL_ESCROW_V2_ADDRESS,
  V2_ENABLED,
  activeChain,
  publicClient,
} from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';
import { useContractAction } from '@/hooks/useContractAction';
import { cn } from '@/lib/utils';

export default function AdminCard() {
  const { t } = useTranslation();
  const { connected, address } = useWallet();
  // Vacío a propósito. Antes venía relleno con el multisig del momento, pero los
  // owners de PanalMultisig son inmutables: rotar jueces exige desplegar otro y
  // volver a pasar por aquí. Con el árbitro vigente precargado, `alreadyMigrated`
  // era true al abrir y el formulario entero desaparecía, dejando el panel
  // inservible para la segunda migración en adelante.
  const [target, setTarget] = useState('');

  const roles = useQuery({
    queryKey: ['escrow-admin', activeChain.id],
    enabled: V2_ENABLED,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [owner, arbitrator] = await Promise.all([
        publicClient.readContract({
          address: PANAL_ESCROW_V2_ADDRESS,
          abi: panalEscrowV2Abi,
          functionName: 'owner',
        }) as Promise<Address>,
        publicClient.readContract({
          address: PANAL_ESCROW_V2_ADDRESS,
          abi: panalEscrowV2Abi,
          functionName: 'arbitrator',
        }) as Promise<Address>,
      ]);
      return { owner, arbitrator };
    },
  });

  const action = useContractAction({ onMined: () => void roles.refetch() });

  if (!V2_ENABLED || !connected || !address || !roles.data) return null;

  const me = address.toLowerCase();
  const isAdmin =
    roles.data.owner.toLowerCase() === me || roles.data.arbitrator.toLowerCase() === me;
  if (!isAdmin) return null;

  const alreadyMigrated = roles.data.arbitrator.toLowerCase() === target.toLowerCase();
  const valid = isAddress(target) && !alreadyMigrated;

  const migrate = () => {
    if (!valid) return;
    void action.run({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'transferArbitrator',
      args: [target as Address],
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-monad/40 bg-coal-2 p-5 ring-glow-monad md:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-monad/15">
          <ShieldCheck size={18} className="text-monad-mist" aria-hidden />
        </span>
        <div>
          <p className="font-display text-[1rem] font-semibold text-coal-text">{t('admin.title')}</p>
          <p className="text-[0.8125rem] text-coal-mute">{t('admin.sub')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 font-mono text-[12px]">
        <p className="text-coal-mute">
          {t('admin.currentArbitrator')}:{' '}
          <a
            href={EXPLORER_ADDRESS(roles.data.arbitrator)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-monad-mist hover:underline"
          >
            {roles.data.arbitrator.slice(0, 8)}…{roles.data.arbitrator.slice(-6)}
            <ExternalLink size={10} aria-hidden />
          </a>
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="multisig-addr" className="text-[0.8125rem] font-medium text-coal-text">
          {t('admin.multisigLabel')}
        </label>
        <input
          id="multisig-addr"
          value={target}
          onChange={(e) => setTarget(e.target.value.trim())}
          spellCheck={false}
          placeholder="0x…"
          className="w-full rounded-xl border border-coal-line bg-paper px-4 py-2.5 font-mono text-[0.8125rem] text-ink focus:border-monad focus:outline-none"
        />
        {alreadyMigrated ? (
          <p className="rounded-xl border border-olive/40 bg-olive/10 px-4 py-2.5 text-[0.75rem] text-olive">
            {t('admin.alreadyMigrated')}
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-[0.75rem] text-coal-mute">
            <TriangleAlert size={12} className="mt-0.5 shrink-0 text-honey" aria-hidden />
            {t('admin.warning')}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={migrate}
        disabled={!valid || action.busy}
        className={cn(
          'btn-monad inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold',
          (!valid || action.busy) && 'opacity-40',
        )}
      >
        {action.busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
        {action.signing
          ? t('hire.step3.signing')
          : action.confirming
            ? t('hire.step3.confirming')
            : t('admin.migrateBtn')}
      </button>

      {action.mined && action.txHash && (
        <p className="rounded-xl border border-olive/40 bg-olive/10 px-4 py-3 text-[0.8125rem] text-olive">
          {t('admin.migratedOk')}{' '}
          <a
            href={EXPLORER_ADDRESS(roles.data.arbitrator)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t('admin.verify')}
          </a>
        </p>
      )}
    </div>
  );
}
