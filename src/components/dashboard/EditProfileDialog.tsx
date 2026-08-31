/**
 * Panal — Edición del metadata del agente propio (updateMetadata on-chain,
 * solo registry v2). Mismo patrón que el registro guiado: campos separados
 * (nombre · descripción · skills · bot:<url>) con validaciones idénticas,
 * chips de skills (Enter/coma), preview en vivo del metadata compuesto y
 * estados de tx firmando → confirmando (EXPLORER_TX) → minado con TxHash.
 * El patrón de escritura es useContractAction (guarda switchChainAsync +
 * `User rejected` → hire.step3.rejected + onMined → refetch del perfil).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import { useContractAction } from '@/hooks/useContractAction';
import { PANAL_REGISTRY_V2_ADDRESS, EXPLORER_TX } from '@/contracts/config';
import { panalRegistryV2Abi } from '@/contracts/abis';
import {
  aNivel,
  aNivelEditable,
  composeAgentMetadata,
  falloDeNivel,
  isHttpsUrl,
  parseAgentMetadata,
  resumirFicha,
  type NivelEditable,
} from '@/lib/agentMetadata';
import type { Marca } from '@/lib/marca';
import MarcaFields from '@/components/dashboard/MarcaFields';
import NivelesFields from '@/components/dashboard/NivelesFields';

/** Máximo de skills (chips) por agente (mismo límite que el registro). */
const MAX_SKILLS = 6;
/** Longitud máxima de cada skill. */
const MAX_SKILL_LEN = 30;

export interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** metadataURI actual del agente (se parsea para pre-rellenar los campos). */
  metadataURI: string;
  /** Nombre visible del agente (título del diálogo). */
  agentName: string;
  /**
   * La dirección del agente, para el avatar de la vista previa.
   *
   * Tiene que ser LA MISMA semilla que usa su tarjeta del panel, o la vista
   * previa enseñaría un hexágono distinto del que ve todo el mundo y parecería
   * que poner un logo le ha cambiado el avatar.
   */
  agentAddress: string;
  /**
   * El precio del registro, en unidades enteras. Solo para avisar si el nivel
   * más barato no coincide: es ese el que enseña el mercado como EL precio.
   */
  precioBase: string;
  /** MON o $PANAL: los niveles se cobran en la moneda del agente. */
  simbolo: string;
  /** Tras minarse la tx (refetch del perfil on-chain). */
  onMined: () => void;
}

export default function EditProfileDialog({
  open,
  onOpenChange,
  metadataURI,
  agentName,
  agentAddress,
  precioBase,
  simbolo,
  onMined,
}: EditProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto border-line bg-paper p-0 sm:rounded-2xl">
        {/* Radix desmonta el contenido al cerrar: el formulario se
            re-inicializa desde metadataURI en cada apertura. */}
        <EditProfileForm
          metadataURI={metadataURI}
          agentName={agentName}
          agentAddress={agentAddress}
          precioBase={precioBase}
          simbolo={simbolo}
          onMined={onMined}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditProfileForm({
  metadataURI,
  agentName,
  agentAddress,
  precioBase,
  simbolo,
  onMined,
  onOpenChange,
}: {
  metadataURI: string;
  agentName: string;
  agentAddress: string;
  precioBase: string;
  simbolo: string;
  onMined: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const initial = useMemo(() => parseAgentMetadata(metadataURI), [metadataURI]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [skills, setSkills] = useState<string[]>(initial.skills);
  const [skillInput, setSkillInput] = useState('');
  const [skillError, setSkillError] = useState<'dup' | 'max' | null>(null);
  const [botUrl, setBotUrl] = useState(initial.botUrl);
  /**
   * Logo y enlaces, tal y como estaban en la ficha.
   *
   * Salen del `metadataURI` que ya se está leyendo, así que un agente que edite
   * su descripción no pierde el logo por no haber tocado esa parte: lo que no
   * se cambia se vuelve a escribir igual.
   */
  const [marca, setMarca] = useState<Marca>(initial.marca);
  /**
   * Los niveles, tal y como estaban.
   *
   * Salen del mismo `metadataURI`, con sus topes de caracteres dentro aunque
   * el formulario no los enseñe: sin arrastrarlos, corregir una tilde en la
   * descripción borraría lo que un agente declaró desde su código.
   */
  const [niveles, setNiveles] = useState<NivelEditable[]>(() =>
    initial.niveles.map(aNivelEditable),
  );
  /** Campos tocados (blur): muestran su error inline. */
  const [touched, setTouched] = useState<Record<'name' | 'desc' | 'botUrl', boolean>>({
    name: false,
    desc: false,
    botUrl: false,
  });
  const touch = (field: keyof typeof touched) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const action = useContractAction({ onMined });

  // ——— Validación por campo (idéntica al registro guiado) ———
  const nameTrim = name.trim();
  const nameValid =
    nameTrim.length >= 2 && nameTrim.length <= 40 && !/[\r\n]/.test(nameTrim);
  const descTrim = description.trim();
  const descValid =
    descTrim.length >= 10 && descTrim.length <= 140 && !/[\r\n]/.test(descTrim);
  const botUrlTrim = botUrl.trim();
  const botUrlValid = botUrlTrim === '' || isHttpsUrl(botUrlTrim);
  // Una fila a medias no se firma: se guardaría una ficha en la que ese nivel
  // sencillamente no está, y su dueño se iría creyendo que sí.
  const nivelesValid = niveles.every((n) => falloDeNivel(n) === null);
  const valid = nameValid && descValid && botUrlValid && nivelesValid;

  // Preview en vivo: mismo formato que compone el registro guiado.
  const composed = useMemo(
    () =>
      composeAgentMetadata({
        name: nameTrim,
        description: descTrim,
        skills,
        botUrl: botUrlTrim,
        marca,
        niveles: niveles.map(aNivel).filter((n) => n !== null),
      }),
    [nameTrim, descTrim, skills, botUrlTrim, marca, niveles],
  );

  // ——— Skills como chips (Enter/coma, mismo patrón del registro) ———
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

  const submit = () => {
    if (!valid || action.busy) return;
    // updateMetadata solo existe en el registry v2 (el botón solo se muestra
    // con V2_ENABLED). La guarda de red (switchChainAsync) va dentro de run.
    void action.run({
      address: PANAL_REGISTRY_V2_ADDRESS,
      abi: panalRegistryV2Abi,
      functionName: 'updateMetadata',
      args: [composed],
    });
  };

  const inputClass = (invalid: boolean) =>
    cn(
      'w-full rounded-xl border bg-paper px-4 py-2.5 text-[0.875rem] text-ink placeholder:text-ink-3 focus:outline-none',
      invalid ? 'border-terra' : 'border-line focus:border-honey',
    );

  return (
    <div className="px-7 pb-7 pt-6">
      <DialogTitle className="display-m text-ink">
        {t('ownAgent.editProfile.title', { name: agentName })}
      </DialogTitle>
      <DialogDescription className="mt-1 text-ink-2">
        {t('ownAgent.editProfile.desc')}
      </DialogDescription>

      {action.mined && action.txHash ? (
        <div className="mt-6 flex flex-col items-center gap-4 py-4 text-center">
          <p className="font-display text-ink">{t('dashReal.txConfirmed')}</p>
          <TxHash hash={action.txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
          >
            {t('common.close')}
          </button>
        </div>
      ) : action.txHash ? (
        <div className="mt-5 flex flex-col items-center gap-3 py-4 text-center">
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
        <div className="mt-5 flex flex-col gap-4">
          {/* Nombre del agente */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-name" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.nameLabel')}
            </label>
            <input
              id="edit-name"
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

          {/* Descripción corta */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-desc" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.descLabel')}
            </label>
            <textarea
              id="edit-desc"
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
            <label htmlFor="edit-skill" className="text-[0.8125rem] font-medium text-ink-2">
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
                id="edit-skill"
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

          {/*
            URL del bot. Aquí NO se exige, al revés que en el alta: este es el
            camino por el que un agente que ya está sin ella la añade, y
            bloquear el guardado le impediría además corregir cualquier otra
            cosa. Vacía se avisa de lo que implica, que es lo que no se decía.
          */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-bot-url" className="text-[0.8125rem] font-medium text-ink-2">
              {t('register.fields.botUrlLabel')}
            </label>
            <input
              id="edit-bot-url"
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
            ) : botUrlTrim === '' ? (
              <p className="text-[0.75rem] leading-relaxed text-terra">
                {t('register.fields.botUrlVacia')}
              </p>
            ) : (
              <p className="text-[0.75rem] leading-relaxed text-ink-3">
                {t('register.fields.botUrlHint')}
              </p>
            )}
          </div>

          {/* Su cara: logo y enlaces. Todo opcional, y se abre solo si ya hay algo. */}
          <MarcaFields marca={marca} onChange={setMarca} idPrefix="edit" seed={agentAddress || agentName} />

          <NivelesFields
            niveles={niveles}
            onChange={setNiveles}
            idPrefix="edit"
            simbolo={simbolo}
            precioBase={precioBase}
          />

          {/* Preview en vivo del metadata compuesto */}
          <div className="rounded-xl border border-line bg-cream px-4 py-3">
            <p className="text-[0.75rem] font-medium text-ink-2">{t('metadata.previewTitle')}</p>
            <p className="mt-1 break-words font-mono text-[0.8125rem] leading-relaxed text-ink">
              {resumirFicha(composed) || <span className="text-ink-3">{t('metadata.previewEmpty')}</span>}
            </p>
          </div>

          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={action.busy}
              className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey disabled:opacity-40"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!valid || action.busy}
              className="btn-monad inline-flex flex-1 items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
            >
              {action.signing && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {action.signing ? t('hire.step3.signing') : t('ownAgent.editProfile.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
