import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Cloud, Laptop } from 'lucide-react';
import Bloque from '@/components/guia/Bloque';
import { cn } from '@/lib/utils';

/**
 * Dónde encender el agente: en un servidor en la nube o en la máquina propia.
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
 * Y todo lo que pone un proxy delante (Caddy, cloudflared) necesita
 * `TRAS_PROXY=1`, o el límite por IP se vuelve uno solo para todos.
 *
 * SOLO DOS PROVEEDORES EN LA NUBE, por decisión del fundador (2026-10-04):
 * Contabo y Cherry Servers. Son de los pocos que, por unos pocos dólares al
 * mes, aceptan sin reparos lo que tenga que ver con cripto: Contabo permite
 * nodos y aplicaciones con blockchain y solo prohíbe minar en sus VPS, y
 * Cherry Servers tiene servidores pensados para nodos de Monad. Un agente no
 * mina. Hetzner, en cambio, prohíbe todo lo que suene a cripto y ha cortado
 * servidores por eso: se nombra para evitarlo.
 *
 * HTTPS SIN COMPRAR DOMINIO. Un VPS da una IP, no una dirección https. Con
 * dominio propio basta un registro A; sin él, `<ip-con-guiones>.sslip.io`
 * resuelve a esa IP y Caddy le saca certificado igual. Así nadie tiene que
 * comprar nada para cumplir la tercera condición.
 */

const OPCIONES = [
  { id: 'nube', Icono: Cloud },
  { id: 'local', Icono: Laptop },
] as const;
type Opcion = (typeof OPCIONES)[number]['id'];

/** Los pasos de cada camino; el código va literal, sin traducir. */
const PASOS: Record<Opcion, Array<{ texto: string; codigo?: string; lenguaje?: 'sh' | 'env' }>> = {
  nube: [
    { texto: 'guia.servidor.nube.p1', codigo: 'ssh root@TU-IP', lenguaje: 'sh' },
    {
      texto: 'guia.servidor.nube.p2',
      codigo:
        'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt-get install -y nodejs\n\nnpx create-panal-agent mi-agente\ncd mi-agente && npm install',
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.nube.p3',
      codigo: 'sudo npm install -g pm2\npm2 start node_modules/tsx/dist/cli.mjs --name mi-agente -- src/server.ts\npm2 save\npm2 startup',
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.nube.p4',
      codigo:
        "sudo apt-get install -y caddy\nprintf '203-0-113-5.sslip.io {\\n  reverse_proxy localhost:8787\\n}\\n' | sudo tee /etc/caddy/Caddyfile\nsudo systemctl reload caddy",
      lenguaje: 'sh',
    },
    {
      texto: 'guia.servidor.nube.p5',
      codigo: '# .env\nPUBLIC_URL=https://203-0-113-5.sslip.io\nTRAS_PROXY=1\n\npm2 restart mi-agente\nnpm run register',
      lenguaje: 'sh',
    },
  ],
  // La máquina propia va aparte: sus pasos cambian según el sistema.
  local: [],
};

/**
 * La máquina propia, por sistema operativo.
 *
 * EL TÚNEL SE CREA DESDE EL PANEL DE CLOUDFLARE y no con `cloudflared tunnel
 * create`: el panel da, para cada sistema, un solo comando que instala el túnel
 * como SERVICIO —arranca solo al encender— con su token dentro. Por la vía de
 * comandos hacía falta además un config.yml con el id del túnel y la ruta de
 * sus credenciales, distinta en cada sistema.
 *
 * PM2 ARRANCA `tsx` DIRECTAMENTE, no `npm start`: en Windows `npm` es un .cmd y
 * `pm2 start npm` intenta ejecutarlo como JavaScript y falla. La plantilla lee
 * su `.env` de la carpeta desde la que se lanza (`dotenv/config`), que es la
 * del proyecto.
 *
 * Y Windows no tiene `pm2 startup`: el arranque se hace con una tarea al
 * iniciar sesión que relanza lo guardado (`pm2 resurrect`).
 */
const SISTEMAS = ['windows', 'mac', 'linux'] as const;
type Sistema = (typeof SISTEMAS)[number];

const ARRANCAR = 'pm2 start node_modules/tsx/dist/cli.mjs --name mi-agente -- src/server.ts';

const PASOS_LOCAL: Array<{ texto: string; nota?: Partial<Record<Sistema, string>>; codigo: string | Record<Sistema, string> }> = [
  {
    texto: 'guia.servidor.local.p1',
    codigo: {
      windows: 'winget install OpenJS.NodeJS.LTS\nwinget install --id Cloudflare.cloudflared',
      mac: 'brew install node cloudflared',
      linux:
        'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt-get install -y nodejs\ncurl -fsSLo cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb\nsudo dpkg -i cloudflared.deb',
    },
    nota: { mac: 'guia.servidor.local.notaMac', linux: 'guia.servidor.local.notaLinux' },
  },
  {
    texto: 'guia.servidor.local.p2',
    codigo: {
      windows: `npx create-panal-agent mi-agente\ncd mi-agente\nnpm install\nnpm install -g pm2\n${ARRANCAR}\npm2 save\nschtasks /create /tn "mi-agente" /sc onlogon /tr "cmd /c pm2 resurrect"`,
      mac: `npx create-panal-agent mi-agente\ncd mi-agente && npm install\nnpm install -g pm2\n${ARRANCAR}\npm2 save\npm2 startup`,
      linux: `npx create-panal-agent mi-agente\ncd mi-agente && npm install\nsudo npm install -g pm2\n${ARRANCAR}\npm2 save\npm2 startup`,
    },
    nota: { windows: 'guia.servidor.local.notaWindows', mac: 'guia.servidor.local.notaStartup', linux: 'guia.servidor.local.notaStartup' },
  },
  {
    texto: 'guia.servidor.local.p3',
    codigo: {
      windows: 'cloudflared.exe service install <TOKEN>',
      mac: 'sudo cloudflared service install <TOKEN>',
      linux: 'sudo cloudflared service install <TOKEN>',
    },
    nota: { windows: 'guia.servidor.local.notaAdmin' },
  },
  {
    texto: 'guia.servidor.local.p4',
    codigo: '# .env\nPUBLIC_URL=https://agente.tu-dominio.com\nTRAS_PROXY=1\n\npm2 restart mi-agente\nnpm run register',
  },
  {
    texto: 'guia.servidor.local.p5',
    codigo: {
      windows:
        'powercfg /change standby-timeout-ac 0\npowercfg /change hibernate-timeout-ac 0\npowercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0\npowercfg /setactive SCHEME_CURRENT',
      mac: 'sudo pmset -a sleep 0\nsudo pmset -a disablesleep 1',
      linux: 'sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target',
    },
  },
];

/** El sistema de quien mira la página, para abrir ya en el suyo. */
function sistemaProbable(): Sistema {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  return /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'windows';
}

function MaquinaPropia() {
  const { t } = useTranslation();
  const [sistema, setSistema] = useState<Sistema>(sistemaProbable);

  return (
    <div className="mt-10 max-w-3xl">
      <div role="tablist" aria-label={t('guia.servidor.local.sistema')} className="inline-flex rounded-full border border-coal-line bg-coal-2 p-1">
        {SISTEMAS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={sistema === s}
            onClick={() => setSistema(s)}
            className={cn(
              'rounded-full px-4 py-1.5 text-[0.875rem] font-semibold transition-colors',
              sistema === s ? 'bg-honey text-[#1B1814]' : 'text-coal-text/75 hover:text-honey',
            )}
          >
            {t(`guia.servidor.local.so.${s}`)}
          </button>
        ))}
      </div>

      <ol role="tabpanel" className="mt-8 flex flex-col gap-9">
        {PASOS_LOCAL.map((paso, i) => {
          const codigo = typeof paso.codigo === 'string' ? paso.codigo : paso.codigo[sistema];
          const nota = paso.nota?.[sistema];
          return (
            <li key={paso.texto} className="grid gap-4 md:grid-cols-[auto_1fr] md:gap-6">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-honey/40 font-mono text-[0.875rem] text-honey"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="leading-[1.65] text-coal-text/80">{t(paso.texto)}</p>
                <Bloque codigo={codigo} lenguaje="sh" className="mt-4" />
                {nota && <p className="mt-3 text-[0.875rem] leading-[1.55] text-coal-mute">{t(nota)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function DondeEncenderlo() {
  const { t } = useTranslation();
  const [opcion, setOpcion] = useState<Opcion>('nube');

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

        <div role="tablist" aria-label={t('guia.servidor.title')} className="mt-12 grid gap-3 sm:grid-cols-2">
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

        {opcion === 'local' && <MaquinaPropia />}

        <ol role="tabpanel" hidden={opcion === 'local'} className="mt-10 flex max-w-3xl flex-col gap-9">
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

        <div className="mt-14 max-w-3xl">
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
