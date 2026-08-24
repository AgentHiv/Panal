/**
 * Los avisos del teléfono. LOCALES, no push.
 *
 * La decisión, y por qué: un push de verdad obligaría al indexador a guardar
 * dirección ↔ teléfono, o sea a inventarle cuentas a un protocolo que no las
 * tiene. Aquí el teléfono mira sus propias tareas y levanta él mismo el aviso;
 * nadie fuera del aparato sabe qué dirección eres.
 *
 * El precio, dicho: la entrega puede tardar en avisar lo que tarde el próximo
 * repaso. La cuenta atrás no —esa se programa como alarma exacta en cuanto se
 * conoce la entrega, porque el plazo de 3 días ya está decidido.
 *
 * NINGÚN aviso mueve dinero: cada movimiento necesita una firma y desde una
 * notificación no se puede firmar. Por eso las acciones son «ver» y «revisar».
 *
 * Sin el plugin nativo (en el navegador, o si no está instalado) esto no falla:
 * no hace nada. La app tiene que funcionar igual.
 */
export interface Aviso {
  id: number;
  titulo: string;
  cuerpo: string;
  /** A dónde lleva al tocarlo. */
  ruta: string;
  /** Epoch ms; si va, se programa para entonces en vez de ahora. */
  cuando?: number;
}

interface PluginAvisos {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(opciones: { notifications: unknown[] }): Promise<unknown>;
}

/**
 * El plugin, si existe.
 *
 * Se busca en el puente en vez de importarse para que `movil/` no dependa de
 * `@capacitor/local-notifications` en el navegador ni en el build de la web.
 */
function plugin(): PluginAvisos | null {
  const cap = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const p = cap?.Plugins?.LocalNotifications;
  return (p as PluginAvisos | undefined) ?? null;
}

export function hayAvisos(): boolean {
  return plugin() !== null;
}

const APAGADOS = 'panal:avisos-apagados:v1';

/**
 * Si la persona los quiere.
 *
 * Encendidos por defecto: los motivos por los que salta un aviso son todos
 * dinero que se pierde si nadie mira —un plazo que vence, un pago que se
 * aprueba solo, una disputa—, así que apagarlos tiene que ser una decisión,
 * no un descuido. Pero tiene que poder tomarse, y hasta ahora no había dónde.
 */
export function avisosEncendidos(): boolean {
  try {
    return localStorage.getItem(APAGADOS) !== 'si';
  } catch {
    return true;
  }
}

export function encenderAvisos(encendidos: boolean): void {
  try {
    if (encendidos) localStorage.removeItem(APAGADOS);
    else localStorage.setItem(APAGADOS, 'si');
  } catch {
    /* sin disco, quedan encendidos: es lo seguro */
  }
}

export async function pedirPermiso(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    const actual = await p.checkPermissions();
    if (actual.display === 'granted') return true;
    const pedido = await p.requestPermissions();
    return pedido.display === 'granted';
  } catch {
    return false;
  }
}

export async function programar(avisos: Aviso[]): Promise<void> {
  const p = plugin();
  if (!p || avisos.length === 0) return;
  try {
    await p.schedule({
      notifications: avisos.map((a) => ({
        id: a.id,
        title: a.titulo,
        body: a.cuerpo,
        extra: { ruta: a.ruta },
        ...(a.cuando && a.cuando > Date.now() ? { schedule: { at: new Date(a.cuando) } } : {}),
      })),
    });
  } catch {
    // Un aviso que no se puede programar no puede romper la pantalla.
  }
}

/**
 * Un id estable por tarea y motivo: reprogramar el mismo aviso lo REEMPLAZA
 * en vez de duplicarlo. Sin esto, cada repaso deja otra copia en la persiana.
 */
export function idDe(taskId: string, motivo: Motivo): number {
  const base = Number(taskId) || 0;
  return (base * 10 + MOTIVOS[motivo]) % 2_147_483_647;
}

/**
 * Los motivos, y su hueco en el id.
 *
 * Los tres primeros son del CLIENTE —le entregaron, se le acaba el plazo para
 * revisar, venció sin entrega—; los tres siguientes son del DUEÑO de un agente:
 * su agente no ha entregado, le han disputado, tiene dinero sin cobrar.
 *
 * Van en la misma tabla y no en dos porque el hueco tiene que ser único: si el
 * aviso de «te entregaron el #54» y el de «tu agente no ha entregado el #54»
 * compartieran número, uno reemplazaría al otro en la persiana y el dueño se
 * quedaría sin enterarse. Esa es exactamente la clase de fallo que estas
 * pantallas existen para evitar.
 */
export type Motivo =
  | 'entrega'
  | 'cuenta-atras'
  | 'plazo'
  | 'sin-entregar'
  | 'disputa'
  | 'sin-cobrar';

const MOTIVOS: Record<Motivo, number> = {
  entrega: 0,
  'cuenta-atras': 1,
  plazo: 2,
  'sin-entregar': 3,
  disputa: 4,
  'sin-cobrar': 5,
};
