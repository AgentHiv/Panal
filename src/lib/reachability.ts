/**
 * Si un agente CONTESTA.
 *
 * POR QUÉ HACE FALTA
 *
 * «Activo» es una marca en la cadena que solo pone y quita el dueño del
 * agente. Un agente cuyo servidor se apagó hace semanas sigue «activo», y el
 * mercado lo pintaba «En línea» porque no miraba nada más: Audit, Lente y
 * Traza llevaban días sin contestar (octubre de 2026) y salían arriba del
 * podio por sus encargos de antes. Quien los contrataba bloqueaba su dinero en
 * el escrow para un encargo que no iba a llegar a nadie, y solo lo recuperaba
 * al vencer el plazo, pagando el gas dos veces.
 *
 * DOS FUENTES, UNA PARA CADA COSA
 *
 *   - La LISTA usa lo que ya mira el indexador al verificar el dominio de cada
 *     agente (bot/src/verificar-dominio.ts, cada 6 h). Así ver el mercado no
 *     hace que el navegador de cada visitante llame a todos los agentes.
 *   - CONTRATAR pregunta al agente directamente, desde el navegador o la app,
 *     sin pasar por nada de Panal: es la que decide si se deja pagar.
 */

/**
 * Los motivos del indexador que dicen «no hay nadie al otro lado».
 *
 * Copiados de `bot/src/verificar-dominio.ts`. Un 404 o una tarjeta que no
 * declara su dirección NO entran: ahí hay un servidor que contesta, y lo que
 * falla es la verificación, no el agente.
 */
const SIN_RESPUESTA = /^(el endpoint no responde|el dominio no resuelve|el endpoint responde 5\d\d)$/;

/**
 * Cuánto vale lo que dijo el indexador. Vuelve a mirar cada 6 h; pasado un
 * día, su respuesta ya no dice nada de ahora y se trata como «no se sabe».
 */
const VIGENCIA_S = 24 * 60 * 60;

/** Lo que guarda el indexador sobre la última vez que miró. */
export interface VerificacionDelIndexador {
  verificado?: boolean | 'sin-dominio';
  verificadoMotivo?: string;
  verificadoTs?: number;
}

/** Si, según la última vuelta del indexador, el agente no contesta. */
export function noRespondeSegunIndexador(f: VerificacionDelIndexador, ahoraS = Date.now() / 1000): boolean {
  if (f.verificado !== false || !f.verificadoMotivo || !f.verificadoTs) return false;
  if (ahoraS - f.verificadoTs > VIGENCIA_S) return false;
  return SIN_RESPUESTA.test(f.verificadoMotivo);
}

/**
 * Pregunta al agente si está.
 *
 * Con `no-cors`: no hace falta leer la respuesta, solo saber si llega. Así
 * vale también con un agente que no declara CORS, que con un `fetch` normal
 * parecería caído aunque reciba encargos sin problema. La promesa solo falla
 * si no hay respuesta ninguna: el dominio no resuelve, la conexión se corta o
 * se agota el plazo.
 */
export async function respondeElAgente(botUrl: string, timeoutMs = 8_000): Promise<boolean> {
  try {
    await fetch(`${botUrl.replace(/\/+$/, '')}/agent.json`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

/** Los que contestan delante, en el orden que ya traían. */
export function losQueRespondenPrimero<T extends { status: string }>(lista: T[]): T[] {
  return [...lista.filter((a) => a.status !== 'no-responde'), ...lista.filter((a) => a.status === 'no-responde')];
}
