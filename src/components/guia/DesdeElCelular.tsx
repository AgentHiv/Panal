import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, ArrowUpRight, Check } from 'lucide-react';

/**
 * Publicar un agente sin ordenador: con la sección de programación de la app de
 * Claude (Claude Code) o de ChatGPT (Codex), un servidor propio y la wallet.
 *
 * NI UNA CLAVE PASA POR PANAL. La regla del contrato manda aquí: la wallet que
 * da de alta el agente ES el agente (`registerAgent` usa `msg.sender`) y es la
 * única que puede entregar. Así que su clave tiene que estar en el servidor que
 * entrega, y el alta se firma con esa misma cuenta desde el móvil. Panal solo
 * explica el camino y prepara el prompt; ni la wallet, ni el generador, ni la
 * plantilla cambian.
 *
 * EL PROMPT VA EN INGLÉS a propósito: son instrucciones para un modelo y tienen
 * que llegar exactas, con los nombres de variables y comandos tal cual. Lo único
 * que cambia con el idioma de la página es en qué idioma le contesta al usuario.
 *
 * Grok no tiene botón: su agente de programación (Grok Build) es de terminal y
 * no hay sección para programar en su app (comprobado el 2026-10-02).
 */

const DESTINOS = [
  { id: 'claude', url: 'https://claude.ai/code', clave: 'guia.movil.claude' },
  { id: 'chatgpt', url: 'https://chatgpt.com/codex', clave: 'guia.movil.chatgpt' },
] as const;

/** El nombre en inglés del idioma de la página, para pedirle a la IA que conteste en él. */
const IDIOMA_EN_INGLES: Record<string, string> = {
  es: 'Spanish',
  en: 'English',
  pt: 'Portuguese',
  fr: 'French',
  ru: 'Russian',
  zh: 'Chinese',
  hi: 'Hindi',
  ar: 'Arabic',
  ur: 'Urdu',
  bn: 'Bengali',
};

/** Lo que se pega en Claude Code o en Codex. */
function promptDelAgente(nombre: string, queHace: string, idioma: string): string {
  const lang = IDIOMA_EN_INGLES[idioma] ? idioma : 'en';
  return `I want to build an agent for Panal, the marketplace of AI agents on Monad (https://panal.lat). Work in this repository.

My agent: ${nombre.trim() || 'my-agent'}
What it does: ${queHace.trim()}

1. Generate the project at the root of the repository: run \`npx create-panal-agent@latest agent --yes --lang ${lang}\` and move everything inside \`agent/\` (including .env.example and .gitignore) to the root.
2. Implement the work in \`handleTask\` in \`src/agent.ts\` so the agent does exactly what is described above. Keep the rest of the template as it is: the server, the delivery, the retries and the automatic withdrawal.
3. Never write a key or a secret in the code or in the repository. They go in the server's environment variables: AGENT_PRIVATE_KEY, LLM_PROVIDER, LLM_API_KEY, LLM_MODEL and PUBLIC_URL.
4. Run \`npm install\` and \`npm run typecheck\`, and fix every error.
5. In README.md, explain how to run it on an Ubuntu VPS from Contabo or Cherry Servers: clone this repository, install Node 26, run \`npm install\`, keep it running with pm2 and put Caddy in front for https. List the environment variables, and say that PUBLIC_URL is the agent's public https address.
6. Open a pull request.

Do not ask me for my private key. Reply to me in ${IDIOMA_EN_INGLES[lang]}.`;
}

const PASOS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;

export default function DesdeElCelular() {
  const { t, i18n } = useTranslation();
  const [nombre, setNombre] = useState('');
  const [queHace, setQueHace] = useState('');
  const listo = queHace.trim().length > 0;

  /**
   * Se copia en el mismo toque que abre el enlace, sin `await` antes de
   * navegar: en el móvil, abrir una pestaña después de una espera lo bloquea el
   * navegador, y el enlace de verdad (`<a>`) es lo que abre la app instalada.
   */
  const alTocar = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    if (!listo) {
      e.preventDefault();
      toast(t('guia.movil.falta'));
      return;
    }
    const idioma = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2);
    navigator.clipboard
      ?.writeText(promptDelAgente(nombre, queHace, idioma))
      .then(() => toast(t('guia.movil.copiado'), { icon: <Check size={14} className="text-olive" /> }))
      .catch(() => toast(t('guia.movil.noCopiado')));
  };

  return (
    <section id="movil" className="border-t border-line bg-paper py-24 md:py-28">
      <div className="container-hive">
        <p className="eyebrow text-honey-deep">{t('guia.movil.eyebrow')}</p>
        <h2 className="display-l mt-4 max-w-2xl text-ink">{t('guia.movil.title')}</h2>
        <p className="mt-5 max-w-2xl leading-[1.65] text-ink-2">{t('guia.movil.text')}</p>

        <ol className="mt-14 flex flex-col gap-12">
          {PASOS.map((p, i) => (
            <motion.li
              key={p}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="grid gap-5 md:grid-cols-[auto_1fr] md:gap-8"
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-honey/50 font-mono text-[0.9375rem] text-honey-deep"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-xl font-semibold text-ink">{t(`guia.movil.${p}.titulo`)}</h3>
                <p className="mt-3 max-w-2xl leading-[1.65] text-ink-2">
                  {/* El paso 5 nombra los botones del alta con SUS etiquetas: si
                      cambian allí, aquí cambian solas y nunca dicen otra cosa. */}
                  {t(`guia.movil.${p}.texto`, {
                    registrar: t('dash.registerAgent'),
                    programa: t('register.tipo.bot'),
                  })}
                </p>

                {p === 'p4' && (
                  <a
                    href="#servidor"
                    className="mt-3 inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold text-honey-deep hover:underline"
                  >
                    {t('guia.movil.p4link')}
                    <ArrowDown size={15} aria-hidden />
                  </a>
                )}

                {p === 'p3' && (
                  <div className="mt-6 flex max-w-2xl flex-col gap-4 rounded-2xl border border-line bg-cream p-5 md:p-6">
                    <label className="flex flex-col gap-2">
                      <span className="text-[0.875rem] font-medium text-ink">{t('guia.movil.nombre')}</span>
                      <input
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        placeholder={t('guia.movil.nombreHueco')}
                        maxLength={60}
                        className="h-11 rounded-xl border border-line bg-paper px-4 text-[0.9375rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-[0.875rem] font-medium text-ink">{t('guia.movil.queHace')}</span>
                      <textarea
                        value={queHace}
                        onChange={(e) => setQueHace(e.target.value)}
                        placeholder={t('guia.movil.queHaceHueco')}
                        rows={4}
                        maxLength={1500}
                        className="rounded-xl border border-line bg-paper px-4 py-3 text-[0.9375rem] leading-[1.55] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                      />
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      {DESTINOS.map((d) => (
                        <a
                          key={d.id}
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={alTocar}
                          aria-disabled={!listo}
                          className="btn-monad inline-flex items-center justify-center gap-1.5 px-5 py-3 text-[0.9375rem] font-semibold aria-disabled:opacity-60"
                        >
                          {t(d.clave)}
                          <ArrowUpRight size={15} aria-hidden />
                        </a>
                      ))}
                    </div>
                    <p className="text-[0.8125rem] leading-[1.55] text-ink-3">{t('guia.movil.plan')}</p>
                  </div>
                )}
              </div>
            </motion.li>
          ))}
        </ol>

        <div className="mt-14 flex max-w-3xl items-start gap-4 rounded-xl border border-honey/40 bg-honey/[0.07] p-6">
          <AlertTriangle size={20} className="mt-[2px] shrink-0 text-honey-deep" strokeWidth={2} />
          <div className="flex flex-col gap-2">
            <p className="font-semibold text-ink">{t('guia.movil.avisos.titulo')}</p>
            <p className="leading-[1.6] text-ink-2">{t('guia.movil.avisos.a1')}</p>
            <p className="leading-[1.6] text-ink-2">{t('guia.movil.avisos.a2')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
