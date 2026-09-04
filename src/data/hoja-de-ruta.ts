/**
 * La hoja de ruta de septiembre a diciembre de 2026, en datos.
 *
 * El texto vive en los locales y aquí solo van las CLAVES, como en la guía de
 * publicar (`guia.ts`). El orden de este array es el orden de la página: los
 * cuatro meses se leen de arriba abajo y cambiar el orden aquí lo cambia allí.
 *
 * Esta página es el reflejo de `ROADMAP.md`, que es donde el plan se discute y
 * se corrige. Si los dos dejan de decir lo mismo, manda el archivo: la web
 * enseña el plan, no lo decide.
 */

/** Un punto del mes: un titular y una frase. */
export interface PuntoMes {
  titulo: string;
  texto: string;
}

export interface MesRuta {
  /** Sufijo de la clave i18n y de React (`sep`, `oct`, `nov`, `dic`). */
  clave: string;
  nombre: string;
  /** El tema del mes en dos palabras, bajo el nombre. */
  tema: string;
  /** La frase que explica por qué el mes va donde va. */
  tesis: string;
  puntos: PuntoMes[];
  /**
   * Cómo se sabe que el mes se cumplió. Una sola frase y falsable: sin esto un
   * mes se da por bueno porque se hizo trabajo, que no es lo mismo.
   */
  check: string;
}

/** Construye las claves de un mes sin repetir el prefijo dieciséis veces. */
function mes(clave: string, puntos: number): MesRuta {
  const base = `hoja.meses.${clave}`;
  return {
    clave,
    nombre: `${base}.nombre`,
    tema: `${base}.tema`,
    tesis: `${base}.tesis`,
    puntos: Array.from({ length: puntos }, (_, i) => ({
      titulo: `${base}.p${i + 1}.titulo`,
      texto: `${base}.p${i + 1}.texto`,
    })),
    check: `${base}.check`,
  };
}

export const MESES_RUTA: MesRuta[] = [mes('sep', 4), mes('oct', 4), mes('nov', 4), mes('dic', 4)];

/**
 * Google Play va en su propia franja y no dentro de un mes: es papeleo y
 * espera, no construcción, y ninguno de sus cuatro pasos ocupa a nadie durante
 * semanas. Ponerlo de tema de un mes daría una idea equivocada del trabajo.
 */
export const PASOS_PLAY = [1, 2, 3, 4].map((n) => ({
  titulo: `hoja.play.p${n}.titulo`,
  cuando: `hoja.play.p${n}.cuando`,
}));

/** Lo que se queda fuera a propósito, con su razón, en los locales. */
export const ESPERA_2027 = ['hoja.espera.e1', 'hoja.espera.e2', 'hoja.espera.e3', 'hoja.espera.e4'];

/** El plan entero, donde se discute y se corrige. */
export const ROADMAP_URL = 'https://github.com/AgentHiv/Panal/blob/main/ROADMAP.md';
