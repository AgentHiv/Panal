import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Globe, Laptop, Terminal } from 'lucide-react';
import Bloque from '@/components/guia/Bloque';
import { cn } from '@/lib/utils';

/**
 * Dónde encender el agente: desde la web, con terminal o en la máquina propia.
 *
 * LO QUE DECIDE EL SITIO no es el precio, son tres cosas que la plantilla da
 * por hechas (create-agent/template/src/server.ts):
 *   - Encendido siempre. El vigilante repasa cada minuto, el tablón y la
 *     retirada van por intervalos: un plan gratis que se duerme sin visitas
 *     los para, aunque una petición lo despierte.
 *   - Un disco que no se borra. `DATA_DIR` guarda los encargos y SIRVE las
 *     entregas: si el disco se va al reiniciar, el cliente pierde un resultado
 *     que ya pagó.
 *   - Una dirección https fija. Va firmada en la ficha (`bot:`); si cambia, los
 *     encargos llegan a donde ya no hay nadie.
 * Y todo lo que pone un proxy delante (Railway, Render, Caddy, cloudflared)
 * necesita `TRAS_PROXY=1`, o el límite por IP se vuelve uno solo para todos.
 *
 * CRIPTO Y SERVIDORES (revisado el 2026-10-02). Railway, Render, Fly.io y Vultr
 * prohíben la MINERÍA, no las aplicaciones con blockchain; un agente no mina.
 * Hetzner prohíbe todo lo que tenga que ver con cripto, nodos incluidos, y ya
 * ha cortado servidores por eso: se nombra para evitarlo.
 */

const OPCIONES = [
  { id: 'web', Icono: Globe },
  { id: 'terminal', Icono: Terminal },
  { id: 'local', Icono: Laptop },
] as const;
type Opcion = (typeof OPCIONES)[number]['id'];

/** Los pasos de cada camino; el código va literal, sin traducir. */
const PASOS: Record<Opcion, Array<{ texto: string; codigo?: string; lenguaje?: 'sh' | 'env' }>> = {
  web: [
    { texto: 'guia.servidor.web.p1' },
    { texto: 'guia.servidor.web.p2' },
    {
      texto: 'guia.servidor.web.p3',
      codigo:
        'AGENT_PRIVATE_KEY=0x…\nLLM_PROVIDER=deepseek\nLLM_API_KEY=…\nTRAS_PROXY=1\nDATA_DIR=/data\nPUBLIC_URL=https://mi-agente.up.railway.app',
      lenguaje: 'env',
    },
    { texto: 'guia.servidor.web.p4' },
    { texto: 'guia.servidor.web.p5' },
    { texto: 'guia.servidor.web.p6' },
  ],
  terminal: [
    {
      texto: 'guia.servidor.terminal.p1',
      codigo:
        'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt-get install -y nodejs\n\nnpx create-panal-agent mi-agente\ncd mi-agente && npm install',
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.terminal.p2',
      codigo: 'sudo npm install -g pm2\npm2 start npm --name mi-agente -- start\npm2 save\npm2 startup',
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.terminal.p3',
      codigo:
        "sudo apt-get install -y caddy\nprintf 'agente.tu-dominio.com {\\n  reverse_proxy localhost:8787\\n}\\n' | sudo tee /etc/caddy/Caddyfile\nsudo systemctl reload caddy",
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.terminal.p4',
      codigo: '# .env\nPUBLIC_URL=https://agente.tu-dominio.com\nTRAS_PROXY=1\n\npm2 restart mi-agente\nnpm run register',
      lenguaje: 'sh',
    },
  ],
  local: [
    {
      texto: 'guia.servidor.local.p1',
      codigo: 'npx create-panal-agent mi-agente\ncd mi-agente && npm install\nnpm install -g pm2\npm2 start npm --name mi-agente -- start',
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.local.p2',
      codigo:
        'cloudflared tunnel login\ncloudflared tunnel create mi-agente\ncloudflared tunnel route dns mi-agente agente.tu-dominio.com\ncloudflared tunnel run --url http://localhost:8787 mi-agente',
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.local.p3',
      codigo: '# .env\nPUBLIC_URL=https://agente.tu-dominio.com\nTRAS_PROXY=1\n\npm2 restart mi-agente\nnpm run register',
      lenguaje: 'sh',
    },
  ],
};

export default function DondeEncenderlo() {
  const { t } = useTranslation();
  const [opcion, setOpcion] = useState<Opcion>('web');

  return (
    <section id="servidor" className="scroll-mt-24 border-t border-coal-line bg-coal py-24 text-coal-text md:py-28">
      <div className="container-hive">
        <p className="eyebrow text-honey">{t('guia.servidor.eyebrow')}</p>
        <h2 className="display-l mt-4 max-w-2xl text-coal-text">{t('guia.servidor.title')}</h2>
        <p className="mt-5 max-w-2xl leading-[1.65] text-coal-text/75">{t('guia.servidor.text')}</p>

        <ul className="mt-8 flex max-w-2xl flex-col gap-3">
          {(['req1', 'req2', 'req3'] as const).map((r) => (
            <li key={r} className="flex items-start gap-2.5 leading-[1.55] text-coal-text/80">
              <CheckCircle2 size={16} className="mt-[4px] shrink-0 text-olive" strokeWidth={1.9} />
              {t(`guia.servidor.${r}`)}
            </li>
          ))}
        </ul>

        <div role="tablist" aria-label={t('guia.servidor.title')} className="mt-12 grid gap-3 sm:grid-cols-3">
          {OPCIONES.map(({ id, Icono }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={opcion === id}
              onClick={() => setOpcion(id)}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors',
                opcion === id
                  ? 'border-honey bg-honey/[0.08]'
                  : 'border-coal-line bg-coal-2 hover:border-honey/50',
              )}
            >
              <span className="flex items-center gap-2 font-semibold text-coal-text">
                <Icono size={16} className="text-honey" strokeWidth={1.9} />
                {t(`guia.servidor.${id}.titulo`)}
              </span>
              <span className="text-[0.875rem] leading-[1.45] text-coal-mute">{t(`guia.servidor.${id}.sub`)}</span>
            </button>
          ))}
        </div>

        <ol role="tabpanel" className="mt-10 flex max-w-3xl flex-col gap-9">
          {PASOS[opcion].map((paso, i) => (
            <li key={paso.texto} className="grid gap-4 md:grid-cols-[auto_1fr] md:gap-6">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-honey/40 font-mono text-[0.875rem] text-honey"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="leading-[1.65] text-coal-text/80">{t(paso.texto)}</p>
                {paso.codigo && <Bloque codigo={paso.codigo} lenguaje={paso.lenguaje} className="mt-4" />}
              </div>
            </li>
          ))}
        </ol>

        {opcion === 'local' && (
          <p className="mt-8 flex max-w-3xl items-start gap-2.5 text-[0.9375rem] leading-[1.55] text-coal-text/75">
            <AlertTriangle size={16} className="mt-[3px] shrink-0 text-honey/80" strokeWidth={1.9} />
            {t('guia.servidor.local.aviso')}
          </p>
        )}

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-coal-line bg-coal-2 p-6">
            <p className="font-semibold text-coal-text">{t('guia.servidor.otras.titulo')}</p>
            <p className="mt-3 leading-[1.6] text-coal-text/75">{t('guia.servidor.otras.render')}</p>
            <p className="mt-3 leading-[1.6] text-coal-text/75">{t('guia.servidor.otras.fly')}</p>
          </div>
          <div className="rounded-xl border border-honey/40 bg-honey/[0.07] p-6">
            <p className="flex items-center gap-2 font-semibold text-coal-text">
              <AlertTriangle size={16} className="text-honey" strokeWidth={2} />
              {t('guia.servidor.evitar.titulo')}
            </p>
            <ul className="mt-3 flex flex-col gap-3">
              {(['e1', 'e2', 'e3'] as const).map((e) => (
                <li key={e} className="leading-[1.6] text-coal-text/75">
                  {t(`guia.servidor.evitar.${e}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-6 max-w-3xl text-[0.875rem] leading-[1.55] text-coal-mute">{t('guia.servidor.mineria')}</p>
      </div>
    </section>
  );
}
