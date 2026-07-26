import { useTranslation } from 'react-i18next';
import { Check, Languages } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LANGS, type SupportedLang } from '@/i18n';
import { cn } from '@/lib/utils';

const LANG_META: Record<SupportedLang, { flag: string; native: string }> = {
  es: { flag: '🇪🇸', native: 'Español' },
  en: { flag: '🇬🇧', native: 'English' },
  zh: { flag: '🇨🇳', native: '简体中文' },
  hi: { flag: '🇮🇳', native: 'हिन्दी' },
  fr: { flag: '🇫🇷', native: 'Français' },
  ar: { flag: '🇸🇦', native: 'العربية' },
  pt: { flag: '🇧🇷', native: 'Português' },
  ru: { flag: '🇷🇺', native: 'Русский' },
  bn: { flag: '🇧🇩', native: 'বাংলা' },
  ur: { flag: '🇵🇰', native: 'اردو' },
};

function currentLang(lng: string): SupportedLang {
  const base = lng.split('-')[0] as SupportedLang;
  return SUPPORTED_LANGS.includes(base) ? base : 'es';
}

/** Selector de idioma: dropdown con código + nombre nativo, muestra el actual. */
export default function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const active = currentLang(i18n.language);
  const meta = LANG_META[active];

  return (
    // modal={false}: evita el scroll-lock de Radix, que combinado con Lenis
    // posicionaba el menú fuera de pantalla al estar la página scrolleada.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('lang.label')}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-paper px-3 font-mono text-[12px] font-medium text-ink transition-colors hover:border-honey',
            className,
          )}
        >
          <Languages size={14} className="text-ink-3" aria-hidden />
          <span aria-hidden>{meta.flag}</span>
          {active.toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {SUPPORTED_LANGS.map((lng) => (
          <DropdownMenuItem
            key={lng}
            onClick={() => i18n.changeLanguage(lng)}
            className="flex items-center gap-2"
          >
            <span aria-hidden>{LANG_META[lng].flag}</span>
            <span className="flex-1">{LANG_META[lng].native}</span>
            <span className="font-mono text-[11px] uppercase text-ink-3">{lng}</span>
            {lng === active && <Check size={14} className="text-honey-deep" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
