/**
 * Panal — el historial de una conversación con un agente.
 *
 * Un hilo pertenece a un PAR: quién habla y con quién. La clave lleva las dos
 * direcciones porque en Panal la wallet es la identidad — cambiar de wallet es
 * cambiar de persona, y sus conversaciones no deben mezclarse ni verse.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DÓNDE VIVE ESTO, Y LO QUE ESO SIGNIFICA
 *
 * Hoy: en `localStorage`, o sea en ESTE navegador. Es honesto decir lo que
 * implica, porque la interfaz tiene que decirlo también: el hilo NO sigue al
 * usuario a otro dispositivo, y borrar los datos del sitio lo pierde.
 *
 * La alternativa está pensada y no elegida: que lo guarde el agente, detrás de
 * la misma firma EIP-191 que ya protege `/result`. Ahí el hilo seguiría a la
 * persona a cualquier teléfono, sin infraestructura nueva. Cuando se decida,
 * lo que cambia es el cuerpo de estas cuatro funciones; nada de la interfaz,
 * que sólo las llama. Ese es el motivo de que este archivo exista en vez de
 * tocar `localStorage` desde el componente.
 * ───────────────────────────────────────────────────────────────────────────
 */

const CLAVE = 'panal:hilos:v1';
/** Mensajes por hilo. Pasado esto se tiran los más viejos. */
const MAX_MENSAJES = 300;
/** Hilos guardados a la vez, por si alguien habla con medio mercado. */
const MAX_HILOS = 60;

export interface Mensaje {
  /** Único dentro del hilo; sirve de key en React y para no duplicar. */
  id: string;
  de: 'yo' | 'agente';
  texto: string;
  /** Epoch en milisegundos. */
  cuando: number;
  /** Lo pagado por este mensaje, en unidades mínimas y como texto. */
  pagado?: string;
  /** El símbolo de lo pagado: `$PANAL`. */
  simbolo?: string;
}

interface Hilos {
  [clave: string]: Mensaje[];
}

/**
 * La clave de un hilo.
 *
 * En minúsculas las dos direcciones: el mismo par escrito con otro checksum
 * es el mismo par, y sin normalizar aparecerían dos conversaciones donde hay
 * una.
 */
function clave(cliente: string, agente: string): string {
  return `${cliente.toLowerCase()}|${agente.toLowerCase()}`;
}

function leerTodo(): Hilos {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return crudo ? (JSON.parse(crudo) as Hilos) : {};
  } catch {
    // Almacenamiento bloqueado o JSON corrupto: se empieza de cero en vez de
    // reventar. Un historial ilegible no puede impedir mandar un mensaje.
    return {};
  }
}

function escribirTodo(hilos: Hilos): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(hilos));
  } catch {
    // Cuota llena. Se intenta una vez más con la mitad de los hilos: perder
    // conversaciones viejas es mejor que perder la que se está teniendo.
    try {
      const entradas = Object.entries(hilos);
      const recortado = Object.fromEntries(entradas.slice(-Math.ceil(entradas.length / 2)));
      localStorage.setItem(CLAVE, JSON.stringify(recortado));
    } catch {
      /* Ni así: se sigue sin guardar. El mensaje ya está enviado y cobrado. */
    }
  }
}

/** Los mensajes de un hilo, del más viejo al más nuevo. */
export function leerHilo(cliente: string, agente: string): Mensaje[] {
  return leerTodo()[clave(cliente, agente)] ?? [];
}

/**
 * Añade un mensaje y devuelve el hilo entero ya actualizado.
 *
 * Devuelve el hilo en vez de nada para que quien llama no tenga que volver a
 * leerlo: es lo que se pinta justo después, y leer dos veces abre la puerta a
 * enseñar una cosa distinta de la que se guardó.
 */
export function anadirMensaje(cliente: string, agente: string, mensaje: Mensaje): Mensaje[] {
  const hilos = leerTodo();
  const k = clave(cliente, agente);
  const hilo = [...(hilos[k] ?? []), mensaje].slice(-MAX_MENSAJES);

  // El hilo tocado se reinserta al final: así el recorte por MAX_HILOS se
  // lleva los que llevan más tiempo sin usarse, no los primeros que se
  // crearon.
  delete hilos[k];
  hilos[k] = hilo;

  const claves = Object.keys(hilos);
  const recortado = claves.length > MAX_HILOS
    ? Object.fromEntries(claves.slice(-MAX_HILOS).map((c) => [c, hilos[c]!]))
    : hilos;

  escribirTodo(recortado);
  return hilo;
}

export interface ResumenHilo {
  agente: string;
  ultimo: Mensaje;
  cuantos: number;
}

/**
 * Los hilos de una persona, del más reciente al más viejo.
 *
 * Es lo que alimenta la bandeja. Se filtra por cliente para que al cambiar de
 * wallet no aparezcan las conversaciones de la anterior.
 */
export function listarHilos(cliente: string): ResumenHilo[] {
  const yo = cliente.toLowerCase();
  const salida: ResumenHilo[] = [];

  for (const [k, mensajes] of Object.entries(leerTodo())) {
    const [dueno, agente] = k.split('|');
    if (dueno !== yo || !agente || !mensajes?.length) continue;
    salida.push({ agente, ultimo: mensajes[mensajes.length - 1]!, cuantos: mensajes.length });
  }
  return salida.sort((a, b) => b.ultimo.cuando - a.ultimo.cuando);
}

/** Borra un hilo. Lo que se borra aquí no está en ningún otro sitio. */
export function borrarHilo(cliente: string, agente: string): void {
  const hilos = leerTodo();
  delete hilos[clave(cliente, agente)];
  escribirTodo(hilos);
}

/** Un id de mensaje, único dentro de la sesión. */
export function nuevoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
