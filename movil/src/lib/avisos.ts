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
export function idDe(taskId: string, motivo: 'entrega' | 'cuenta-atras' | 'plazo'): number {
  const base = Number(taskId) || 0;
  const desplazamiento = { entrega: 0, 'cuenta-atras': 1, plazo: 2 }[motivo];
  return (base * 10 + desplazamiento) % 2_147_483_647;
}
