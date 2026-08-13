/**
 * Panal — Alta real de agente en PanalRegistry (asistente guiado).
 * registerAgent(metadataURI, pricePerTask) con estados de tx:
 * firmando → confirmando (link al explorador) → éxito con TxHash real.
 * El metadataURI se compone de campos separados (nombre · descripción ·
 * skills [, · bot:<url>]) para que usuarios no técnicos generen el
 * formato correcto sin escribirlo a mano.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, TriangleAlert, X } from 'lucide-react';
import { useSwitchChain, useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import { ensureActiveChain } from '@/lib/ensureChain';
import { useTxReceipt } from '@/hooks/useTxReceipt';
import { useWallet } from '@/hooks/useWallet';
import {
  EXPLORER_TX,
  NATIVE_CURRENCY,
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  V2_ENABLED,
  activeChain,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi } from '@/contracts/abis';
import { isHttpsUrl } from '@/lib/agentMetadata';

export interface RegisterAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Máximo de skills (chips) por agente. */
const MAX_SKILLS = 6;
/** Longitud máxima de cada skill. */
const MAX_SKILL_LEN = 30;
/** Repo del bot de Panal (guía post-registro). */
const BOT_REPO_URL = 'https://github.com/AgentHiv/Panal/tree/main/bot';


export default function RegisterAgentDialog({ open, onOpenChange }: RegisterAgentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto border-line bg-paper p-0 sm:rounded-2xl">
        <RegisterAgentForm onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function RegisterAgentForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [skillError, setSkillError] = useState<'dup' | 'max' | null>(null);
  const [price, setPrice] = useState('');
  /** Moneda del precio (solo con V2_ENABLED): 'MON' nativo o '$PANAL' token. */
  const [currency, setCurrency] = useState<'MON' | '$PANAL'>('MON');
  const [botUrl, setBotUrl] = useState('');
  /** Campos tocados (blur): muestran su error inline. */
  const [touched, setTouched] = useState<Record<'name' | 'desc' | 'price' | 'botUrl', boolean>>({
    name: false,
    desc: false,
    price: false,
    botUrl: false,
  });
  const touch = (field: keyof typeof touched) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const {
    writeContract,
    data: txHash,
    isPending: signing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { confirming, mined, reverted } = useTxReceipt(txHash);

  const { connected, wrongNetwork, switchToMonad, chainId } = useWallet();
  const { switchChainAsync } = useSwitchChain();

  // ——— Validación por campo ———
  const nameTrim = name.trim();
  const nameValid =
    nameTrim.length >= 2 && nameTrim.length <= 40 && !/[\r\n]/.test(nameTrim);
  const descTrim = description.trim();
  const descValid =
    descTrim.length >= 10 && descTrim.length <= 140 && !/[\r\n]/.test(descTrim);
  // Validación estricta del string: evita que parseEther lance con notación
  // científica o más de 18 decimales (crash del componente).
  const priceStr = price.replace(',', '.').trim();
  const priceValid = /^\d+(\.\d{1,18})?$/.test(priceStr) && Number(priceStr) > 0;
  const botUrlTrim = botUrl.trim();
  const botUrlValid = botUrlTrim === '' || isHttpsUrl(botUrlTrim);
  const valid = nameValid && descValid && priceValid && botUrlValid;

  // Metadata on-chain: "Nombre · descripción · skill1, skill2 · bot:<url>".
  // Las skills van en UN segmento separadas por comas (mismo formato que
  // antes se pedía a mano en el texto libre).
  const metadataURI = useMemo(() => {
    const parts = [nameTrim, descTrim, skills.join(', ')].filter(Boolean);
    let composed = parts.join(' · ');
    if (botUrlTrim) composed += ` · bot:${botUrlTrim}`;
    return composed;
  }, [nameTrim, descTrim, skills, botUrlTrim]);

  // ——— Skills como chips ———
  const addSkill = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    if (skills.length >= MAX_SKILLS) {
      setSkillError('max');
      return;
    }
    if (skills.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setSkillError('dup');
      return;
    }
    setSkillError(null);
    setSkills((prev) => [...prev, value.slice(0, MAX_SKILL_LEN)]);
  };

  const removeSkill = (skill: string) => {
    setSkillError(null);
    setSkills((prev) => prev.filter((s) => s !== skill));
  };

  const onSkillInputChange = (value: string) => {
    // Coma = separador: añade lo anterior como chip y conserva el resto.
    if (value.includes(',')) {
      const [head, ...rest] = value.split(',');
      addSkill(head);
      setSkillInput(rest.join(','));
      return;
    }
    setSkillError(null);
    setSkillInput(value);
  };

  const onSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkill(skillInput);
      setSkillInput('');
    } else if (e.key === 'Backspace' && skillInput === '' && skills.length > 0) {
      removeSkill(skills[skills.length - 1]);
    }
  };

  const submit = async () => {
    if (!valid) return;
    // Guarda de red: verificar la chain REAL de la wallet (eth_chainId) y
    // re-verificar tras el cambio; continuar automáticamente al confirmarlo
    // (un solo clic del usuario).
    const chainOk = await ensureActiveChain({ connected, chainId, switchChainAsync });
    if (!chainOk) {
      toast(t('wallet.wrongChainToast'), {
        description: t('wallet.wrongChainToastDesc', { network: `${activeChain.name} · ${activeChain.id}` }),
      });
      return;
    }
    // v2: registerAgent(metadataURI, pricePerTask, currency) en registry v2;
    // v1: registerAgent(metadataURI, pricePerTask) en el registry clásico.
    const onSent = {
      onSuccess: () =>
        toast(t('register.txSent'), {
          description: t('register.txSentDesc'),
        }),
    };
    if (V2_ENABLED) {
      const currencyAddr = currency === '$PANAL' ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY;
      writeContract(
        {
          address: PANAL_REGISTRY_V2_ADDRESS,
          abi: panalRegistryV2Abi,
          functionName: 'registerAgent',
          args: [metadataURI, parseEther(priceStr), currencyAddr],
          chainId: activeChain.id,
        },
        onSent,
      );
    } else {
      writeContract(
        {
          address: PANAL_REGISTRY_ADDRESS,
          abi: panalRegistryAbi,
          functionName: 'registerAgent',
          args: [metadataURI, parseEther(priceStr)],
          chainId: activeChain.id,
        },
        onSent,
      );
    }
  };

  const reset = () => {
    resetWrite();
    setName('');
    setDescription('');
    setSkills([]);
    setSkillInput('');
    setSkillError(null);
    setPrice('');
    setCurrency('MON');
    setBotUrl('');
    setTouched({ name: false, desc: false, price: false, botUrl: false });
  };

  const inputClass = (invalid: boolean) =>
    cn(
      'w-full rounded-xl border bg-paper px-4 py-2.5 text-[0.875rem] text-ink placeholder:text-ink-3 focus:outline-none',
      invalid ? 'border-terra' : 'border-line focus:border-honey',
    );

  return (
    <div className="px-7 pb-7 pt-6">
      <DialogTitle className="display-m text-ink">{t('dash.registerAgent')}</DialogTitle>
      <DialogDescription className="sr-only">
        {t('register.desc')}
      </DialogDescription>

      {mined && txHash ? (
        <div className="mt-6 flex flex-col items-center gap-5 py-2 text-center">
          <svg viewBox="0 0 96 96" className="h-20 w-20">
            <polygon
              points="88,48 68,82.64 28,82.64 8,48 28,13.36 68,13.36"
              fill="#F2EFFA"
              stroke="#E29A2E"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <circle cx="48" cy="48" r="15" fill="#6E7B4E" />
            <path d="M41 48.5l5 5 9-10" stroke="#F2EFFA" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="display-m text-ink">{t('register.success')}</p>
            <p className="mt-1 text-[0.875rem] text-ink-2">
              {t('register.successDesc')}
            </p>
          </div>
          <TxHash hash={txHash} className="rounded-full border border-line bg-cream px-4 py-2" />

          {/* Guía post-registro: bot de Panal para agentes automatizados */}
          <div className="w-full rounded-xl border border-line bg-cream px-4 py-4 text-left">
            <p className="text-[0.875rem] font-semibold text-ink">{t('register.post.title')}</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">
              {t('register.post.desc')}
            </p>
            <a
              href={BOT_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-honey-deep transition-colors hover:text-honey"
            >
              {t('register.post.link')}
              <ExternalLink size={13} />
            </a>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <a
              href={EXPLORER_TX(txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 btn-monad px-5 py-3 text-[0.875rem] font-semibold"
            >
              {t('hire.step3.viewExplorer')}
              <ExternalLink size={14} />
            </a>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex-1 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">
            {t('register.explain')}{' '}
            <span className="font-mono text-[12px]">{t('register.formatHint')}</span>
          </p>

          {/* Nombre del agente */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-name" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.nameLabel')}
            </label>
            <input
              id="reg-name"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[\r\n]/g, ''))}
              onBlur={() => touch('name')}
              maxLength={60}
              placeholder={t('register.fields.namePlaceholder')}
              aria-invalid={touched.name && !nameValid}
              className={inputClass(touched.name && !nameValid)}
            />
            {touched.name && !nameValid && (
              <p className="text-[0.75rem] text-terra">{t('register.fields.nameError')}</p>
            )}
          </div>

          {/* Qué hace (descripción corta) */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-desc" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.descLabel')}
            </label>
            <textarea
              id="reg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => touch('desc')}
              rows={2}
              maxLength={200}
              placeholder={t('register.fields.descPlaceholder')}
              aria-invalid={touched.desc && !descValid}
              className={cn(inputClass(touched.desc && !descValid), 'resize-none')}
            />
            <div className="flex items-center justify-between gap-2">
              {touched.desc && !descValid ? (
                <p className="text-[0.75rem] text-terra">{t('register.fields.descError')}</p>
              ) : (
                <span />
              )}
              <span className="shrink-0 font-mono text-[11px] text-ink-3">
                {descTrim.length}/140
              </span>
            </div>
          </div>

          {/* Skills como chips */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-skill" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.skillsLabel')}
            </label>
            <div
              className={cn(
                'flex w-full flex-wrap items-center gap-1.5 rounded-xl border bg-paper px-3 py-2 focus-within:border-honey',
                skillError ? 'border-terra' : 'border-line',
              )}
            >
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full border border-honey/50 bg-honey-soft px-2.5 py-1 text-[0.75rem] font-medium text-honey-deep"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => removeSkill(skill)}
                    aria-label={t('register.fields.skillRemoveAria', { skill })}
                    className="rounded-full p-0.5 transition-colors hover:text-terra"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                id="reg-skill"
                value={skillInput}
                onChange={(e) => onSkillInputChange(e.target.value)}
                onKeyDown={onSkillKeyDown}
                onBlur={() => {
                  if (skillInput.trim()) {
                    addSkill(skillInput);
                    setSkillInput('');
                  }
                }}
                placeholder={skills.length === 0 ? t('register.fields.skillsPlaceholder') : ''}
                className="min-w-[7rem] flex-1 bg-transparent px-1 py-1 text-[0.8125rem] text-ink placeholder:text-ink-3 focus:outline-none"
              />
            </div>
            {skillError ? (
              <p className="text-[0.75rem] text-terra">
                {skillError === 'dup'
                  ? t('register.fields.skillsDupError')
                  : t('register.fields.skillsMaxError', { max: MAX_SKILLS })}
              </p>
            ) : (
              <p className="text-[0.75rem] text-ink-3">
                {t('register.fields.skillsHint', { max: MAX_SKILLS })}
              </p>
            )}
          </div>

          {/* Precio */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-price" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.priceLabel')}
            </label>
            <div className="flex items-center gap-3">
              <input
                id="reg-price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onBlur={() => touch('price')}
                inputMode="decimal"
                placeholder="0.05"
                aria-label={t('ownAgent.priceAria')}
                aria-invalid={touched.price && !priceValid}
                className={cn(
                  inputClass(touched.price && !priceValid),
                  'font-mono',
                )}
              />
              <span className="shrink-0 font-mono text-[0.8125rem] text-ink-2">
                {currency === '$PANAL' ? t('common.tokenTask') : t('common.monTask')}
              </span>
            </div>
            {touched.price && !priceValid && (
              <p className="text-[0.75rem] text-terra">{t('register.fields.priceError')}</p>
            )}
          </div>

          {/* Selector de moneda (solo contratos v2 desplegados) */}
          {V2_ENABLED && (
            <div className="flex flex-col gap-2">
              <span className="text-[0.8125rem] font-medium text-ink-2">{t('register.currencyLabel')}</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('register.currencyLabel')}>
                {(['MON', '$PANAL'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={currency === c}
                    onClick={() => setCurrency(c)}
                    className={cn(
                      'rounded-full border px-4 py-2.5 font-mono text-[0.8125rem] font-medium transition-colors',
                      currency === c
                        ? 'border-honey bg-honey-soft text-honey-deep'
                        : 'border-line text-ink-2 hover:border-honey',
                    )}
                  >
                    {c === 'MON' ? t('register.currencyNative') : t('register.currencyToken')}
                  </button>
                ))}
              </div>
              <p className="text-[0.75rem] leading-relaxed text-ink-3">
                {currency === '$PANAL' ? t('register.currencyTokenHint') : t('register.currencyNativeHint')}
              </p>
            </div>
          )}

          {/* URL del bot (opcional) */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-bot-url" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.botUrlLabel')}
            </label>
            <input
              id="reg-bot-url"
              value={botUrl}
              onChange={(e) => setBotUrl(e.target.value)}
              onBlur={() => touch('botUrl')}
              inputMode="url"
              placeholder="https://mi-bot.com"
              aria-invalid={touched.botUrl && !botUrlValid}
              className={cn(inputClass(touched.botUrl && !botUrlValid), 'font-mono')}
            />
            {touched.botUrl && !botUrlValid ? (
              <p className="text-[0.75rem] text-terra">{t('register.fields.botUrlError')}</p>
            ) : (
              <p className="text-[0.75rem] leading-relaxed text-ink-3">
                {t('register.fields.botUrlHint')}
              </p>
            )}
          </div>

          {/* Preview en vivo del metadata on-chain */}
          <div className="rounded-xl border border-line bg-cream px-4 py-3">
            <p className="text-[0.75rem] font-medium text-ink-2">{t('register.previewTitle')}</p>
            <p className="mt-1 break-words font-mono text-[0.8125rem] leading-relaxed text-ink">
              {metadataURI || (
                <span className="text-ink-3">{t('register.previewEmpty')}</span>
              )}
            </p>
          </div>

          {writeError && (
            <p className="flex items-start gap-2 rounded-xl border border-terra/40 bg-terra/10 px-4 py-3 text-[0.8125rem] text-terra">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              {writeError.message.includes('User rejected')
                ? t('hire.step3.rejected')
                : writeError.message.includes('already registered')
                  ? t('register.alreadyRegistered')
                  : writeError.message.includes('does not match the target chain')
                    ? t('wallet.chainMismatch', { network: `${activeChain.name} · ${activeChain.id}` })
                    : writeError.message.split("\n")[0]}
            </p>
          )}

          {/* Revertida: se minó, gastó gas y no registró nada. Antes esto caía
              en la rama de éxito y el usuario se iba con un agente que no
              existía. El recibo no trae el motivo, así que se nombra la causa
              con diferencia más habitual: el contrato solo admite un agente
              por wallet. Se deja debajo el bloque de botones para poder
              corregir y reintentar sin cerrar el diálogo. */}
          {reverted && txHash && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-terra/40 bg-terra/10 px-4 py-4 text-center">
              <TriangleAlert size={20} className="text-terra" aria-hidden />
              <div>
                <p className="text-[0.875rem] font-semibold text-terra">{t('register.reverted')}</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">
                  {t('register.revertedDesc')}
                </p>
              </div>
              <TxHash hash={txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
            </div>
          )}

          {txHash && !mined && !reverted ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <Loader2 size={28} className="animate-spin text-honey-deep" aria-hidden />
              <p className="text-[0.875rem] font-medium text-ink">{t('hire.step3.confirming')}</p>
              <a
                href={EXPLORER_TX(txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
              >
                {t('hire.step3.viewTx')}
                <ExternalLink size={13} />
              </a>
              {confirming && <p className="font-mono text-[11px] text-ink-3">{t('hire.step3.oneConfirm')}</p>}
            </div>
          ) : (
            <div className="mt-1 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
              >
                {t('common.cancel')}
              </button>
              {connected && wrongNetwork ? (
                <button
                  type="button"
                  onClick={switchToMonad}
                  className="btn-monad inline-flex flex-1 items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold"
                >
                  {t('wallet.switchNetwork')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!valid || signing}
                  className="btn-monad inline-flex flex-1 items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                >
                  {signing && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  {signing ? t('hire.step3.signing') : t('register.submit')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
