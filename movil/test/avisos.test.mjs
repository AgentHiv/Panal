/**
 * Los ids de los avisos, que es lo único suyo que se puede romper en silencio.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ IMPORTA UN NÚMERO
 *
 * Android identifica cada notificación por un entero. Programar dos veces el
 * mismo id no deja dos avisos: el segundo REEMPLAZA al primero en la persiana.
 * Eso es justo lo que se quiere cuando se reprograma el mismo aviso —si no,
 * cada repaso dejaría otra copia—, y es un fallo grave cuando dos avisos
 * distintos caen en el mismo número: uno de los dos deja de existir y nadie
 * ve un error en ninguna parte.
 *
 * El caso que esto vigila es concreto. `idDe` mezcla el número del encargo con
 * el hueco del motivo (`base * 10 + hueco`), así que hay exactamente diez
 * huecos y los motivos ya van por siete. Añadir el octavo sin pensarlo, o
 * reordenar los que ya se emitieron, hace que el aviso de «te entregaron el
 * #54» y el de «tu agente no ha entregado el #54» compartan número — y el
 * dueño se queda sin enterarse de lo suyo.
 * ───────────────────────────────────────────────────────────────────────────
 */
globalThis.__VITE_ENV__ = { VITE_CHAIN: 'mainnet' };

const { idDe } = await import('../src/lib/avisos.ts');

let bien = 0;
let mal = 0;
const dice = (nombre, ok) => {
  console.log(`  ${ok ? '✅' : '❌'} ${nombre}`);
  ok ? bien++ : mal++;
};

/** Los siete motivos que hoy se programan. */
const MOTIVOS = [
  'entrega',
  'cuenta-atras',
  'plazo',
  'sin-entregar',
  'disputa',
  'sin-cobrar',
  'encargo-nuevo',
];

console.log('\ndos avisos distintos del mismo encargo no se pisan');
{
  const ids = MOTIVOS.map((m) => idDe('54', m));
  dice('los siete motivos dan siete ids', new Set(ids).size === MOTIVOS.length);
  dice(
    'y ninguno cabe fuera del entero de Android',
    ids.every((n) => Number.isInteger(n) && n >= 0 && n < 2_147_483_647),
  );
}

console.log('\nel mismo aviso, dos veces, es el mismo aviso');
{
  dice('reprogramarlo reemplaza', idDe('54', 'entrega') === idDe('54', 'entrega'));
  dice('y no depende de cuándo se pregunte', idDe('7', 'disputa') === idDe('7', 'disputa'));
}

console.log('\ny dos encargos distintos tampoco se pisan');
{
  dice('#54 y #55, mismo motivo', idDe('54', 'entrega') !== idDe('55', 'entrega'));
  dice(
    'ni cruzados: #5 con un motivo y #54 con otro',
    new Set(['5', '54', '540'].flatMap((id) => MOTIVOS.map((m) => idDe(id, m)))).size ===
      3 * MOTIVOS.length,
  );
}

console.log('\ny lo que no es un número no rompe nada');
{
  dice('un id vacío da un aviso válido', Number.isInteger(idDe('', 'entrega')));
  dice('y uno con letras también', Number.isInteger(idDe('no-es-un-id', 'plazo')));
}

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
