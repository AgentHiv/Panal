/**
 * La cartera: qué se avisa de cada agente y cuántas firmas hacen falta.
 *
 * Lo del número de firmas no es un adorno: el diseño llevaba un botón
 * «Cobrarlo todo · 1 firma» que hoy no puede existir, porque `withdraw(token)`
 * paga a quien firma. Aquí se cuenta lo que de verdad cuesta.
 */
import { avisar, tono, totales } from '../src/lib/cartera.ts';

let bien = 0, mal = 0;
const dice = (q, c) => { if (c) { bien++; console.log('  ✅', q); } else { mal++; console.log('  ❌', q); } };

const agente = (extra = {}) => ({
  direccion: '0xaaa', nombre: 'Audit', registrado: true, activo: true,
  precio: 15000n * 10n ** 18n, moneda: '$PANAL', conEndpoint: true,
  panal: 0n, mon: 0n, vencidos: 0, abiertos: 0, ...extra,
});

console.log('\nlo que se avisa, y en qué orden de gravedad');
dice('uno sano no dice nada', avisar(agente()) === null);
dice('y no se pinta', tono(agente()) === null);
dice('sin registrar, lo primero', avisar(agente({ registrado: false, vencidos: 3 })).includes('No está registrada'));
dice('un plazo vencido manda sobre lo demás',
  avisar(agente({ vencidos: 1, activo: false, conEndpoint: false })).includes('plazo vencido'));
dice('y va en rojo', tono(agente({ vencidos: 1 })) === 'rojo');
dice('en plural cuenta cuántos', avisar(agente({ vencidos: 3 })).includes('3 encargos'));

console.log('\npausado');
dice('pausado con dinero dentro avisa de las dos cosas',
  avisar(agente({ activo: false, panal: 100n })) === 'Pausado y con dinero dentro.');
dice('y si además no tiene endpoint, lo dice',
  avisar(agente({ activo: false, conEndpoint: false, panal: 100n })).includes('endpoint'));
dice('en miel, que no es urgente pero cuesta dinero', tono(agente({ activo: false, panal: 100n })) === 'miel');
dice('pausado y a cero es solo informativo',
  avisar(agente({ activo: false })).includes('no sale en el mercado'));
dice('y va en gris', tono(agente({ activo: false })) === 'gris');

console.log('\nactivo pero mudo');
dice('activo sin endpoint avisa', avisar(agente({ conEndpoint: false })).includes('Sin endpoint'));
dice('en miel', tono(agente({ conEndpoint: false })) === 'miel');

console.log('\nencargos abiertos en plazo');
dice('uno abierto se menciona', avisar(agente({ abiertos: 1 })) === 'Tiene un encargo abierto.');
dice('varios, con número', avisar(agente({ abiertos: 4 })).includes('4 encargos'));
dice('en gris: es normal, no un problema', tono(agente({ abiertos: 2 })) === 'gris');
dice('pero un vencido le gana', avisar(agente({ abiertos: 4, vencidos: 1 })).includes('vencido'));

console.log('\nsolo un aviso por fila');
const a = avisar(agente({ activo: false, conEndpoint: false, panal: 5n, abiertos: 2, vencidos: 1 }));
dice('con todo mal, sale uno solo', a.split('.').filter((x) => x.trim()).length <= 2);
dice('y es el más grave', a.includes('vencido'));

console.log('\nlas firmas que hacen falta de verdad');
let t = totales([agente({ panal: 100n }), agente({ mon: 50n }), agente()]);
dice('una por agente y moneda con saldo', t.firmas === 2);
dice('el que no tiene nada no suma firma', t.firmas !== 3);
t = totales([agente({ panal: 100n, mon: 50n })]);
dice('un agente con las dos monedas son DOS firmas', t.firmas === 2);
dice('no una', t.firmas !== 1);
t = totales([agente(), agente()]);
dice('cartera a cero, cero firmas', t.firmas === 0);

console.log('\nlos totales');
t = totales([
  agente({ panal: 85361n }), agente({ panal: 2203n, mon: 336n, activo: false }),
  agente({ mon: 58n }), agente({ registrado: false }),
]);
dice('$PANAL suma', t.panal === 87564n);
dice('MON suma aparte', t.mon === 394n);
dice('activos cuenta solo los registrados', t.activos === 2);
dice('pausados también', t.pausados === 1);
dice('el que no está registrado no cuenta en ninguno', t.activos + t.pausados === 3);
dice('firmas: dos monedas del segundo más una de cada uno de los otros dos', t.firmas === 4);

console.log('\nen riesgo');
t = totales([agente({ vencidos: 2 }), agente({ vencidos: 1 }), agente({ abiertos: 5 })]);
dice('cuenta agentes, no encargos', t.enRiesgo === 2);
dice('lo abierto en plazo no es riesgo', totales([agente({ abiertos: 9 })]).enRiesgo === 0);

console.log('\nvacío');
t = totales([]);
dice('todo a cero sin reventar', t.panal === 0n && t.mon === 0n && t.firmas === 0 && t.activos === 0);

console.log(`\n${bien} bien, ${mal} mal\n`);
process.exit(mal ? 1 : 0);
