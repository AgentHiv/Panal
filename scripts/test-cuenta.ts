/**
 * La prueba de cuenta, leída por las DOS capas que la leen.
 *
 *     npx tsx scripts/test-cuenta.ts     (o: pnpm test:cuenta)
 *
 * Una persona demuestra que su GitHub es suyo firmando un mensaje con su
 * wallet y publicando la firma en un gist de esa cuenta. Quien COMPONE el
 * mensaje es el marketplace (`src/lib/cuenta.ts`); quien lo RECOMPONE para
 * comprobar la firma es el indexador (`bot/src/verificar-cuenta.ts`), que tiene
 * su propia copia porque no depende de ese paquete.
 *
 * LO QUE SE ROMPE SI SE SEPARAN NO DA NINGÚN ERROR. Una coma, un acento o un
 * espacio de diferencia y la firma sigue siendo válida —sobre otro texto—, así
 * que el indexador recupera una dirección cualquiera y decide que no cuadra.
 * El resultado es que TODAS las insignias publicadas caen a la vez, con el
 * motivo «la firma es de 0x…», que es verdad y no explica nada. Y no se ve
 * mirando ninguno de los dos archivos: se ve cuando alguien pregunta por qué
 * perdió la suya.
 *
 * Por eso el primer bloque compara los bytes de las dos, y el segundo los
 * compara contra un literal escrito a mano: si alguien cambia el formato en los
 * dos sitios a la vez, sigue siendo un cambio que invalida lo ya publicado y
 * tiene que costar borrar una prueba, no pasar de largo.
 */
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { componerMensajeDeCuenta, extraerFirma, normalizarUsuario } from '../src/lib/cuenta';
import {
  componerMensajeDeCuenta as componerBot,
  extraerFirma as extraerBot,
  normalizarUsuario as normalizarBot,
} from '../bot/src/verificar-cuenta';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos += 1;
};

/** Una clave de juguete. No custodia nada: existe para firmar en esta prueba. */
const CLAVE = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const CHAIN = 143;

async function main(): Promise<void> {
  const cuenta = privateKeyToAccount(CLAVE);
  const direccion = cuenta.address;

  console.log('\n1. Las dos copias componen el mismo mensaje\n');
  {
    const casos = [
      { direccion, red: 'github' as const, usuario: 'marta', chainId: CHAIN },
      { direccion, red: 'github' as const, usuario: '@Marta', chainId: CHAIN },
      { direccion, red: 'github' as const, usuario: 'Marta/mi-agente', chainId: CHAIN },
      { direccion: direccion.toLowerCase(), red: 'github' as const, usuario: 'marta', chainId: 10143 },
    ];
    for (const c of casos) {
      check(`«${c.usuario}» en ${c.chainId}`, componerMensajeDeCuenta(c) === componerBot(c));
    }
    check(
      'y la normalización también coincide',
      ['Marta', '@Marta', 'Marta/repo', 'MARTA/repo/hondo'].every((u) => normalizarUsuario(u) === normalizarBot(u)),
    );
  }

  console.log('\n2. Y son estos bytes exactos\n');
  {
    const esperado = [
      'Panal · verificación de cuenta',
      'Firmando esto demuestro que esta cuenta y esta dirección son de la misma persona.',
      'cuenta: github:marta',
      `dirección: ${direccion.toLowerCase()}`,
      'chainId: 143',
    ].join('\n');
    const dado = componerMensajeDeCuenta({ direccion, red: 'github', usuario: '@Marta/mi-agente', chainId: CHAIN });
    check('cinco líneas, minúsculas, sin el /repo', dado === esperado, JSON.stringify(dado));
  }

  console.log('\n3. La firma se encuentra dentro de un fichero escrito a mano\n');
  {
    const firma = await cuenta.signMessage({
      message: componerMensajeDeCuenta({ direccion, red: 'github', usuario: 'marta', chainId: CHAIN }),
    });
    check('con el mensaje pegado encima', extraerFirma(`mi prueba de Panal\n\n${firma}\n`) === firma);
    check('y con la firma pegada sin más', extraerFirma(firma) === firma);
    check('las dos copias encuentran la misma', extraerBot(`ruido ${firma} ruido`) === firma);
    check('un hexadecimal corto no es una firma', extraerFirma(`0x${'ab'.repeat(20)}`) === null);
    check('y un fichero vacío tampoco', extraerFirma('') === null);
  }

  console.log('\n4. Quien firma es quien dice ser\n');
  {
    const mensaje = componerBot({ direccion, red: 'github', usuario: 'marta', chainId: CHAIN });
    const firma = await cuenta.signMessage({ message: mensaje });
    const quien = await recoverMessageAddress({ message: mensaje, signature: firma });
    check('la firma recupera la dirección registrada', quien.toLowerCase() === direccion.toLowerCase());
  }

  console.log('\n5. Copiar el gist de otro no sirve de nada\n');
  {
    // El ataque: Marta publica su prueba y otro la copia en SU cuenta para
    // heredar la insignia. No funciona porque el mensaje ata las dos cosas —la
    // dirección Y el nombre de la cuenta— y el verificador lo recompone con las
    // suyas, no con las de Marta. Es también por lo que esto no necesita nonce
    // ni que el indexador guarde estado.
    const suyo = componerBot({ direccion, red: 'github', usuario: 'marta', chainId: CHAIN });
    const firma = await cuenta.signMessage({ message: suyo });

    const ladron = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
    const otraCuenta = componerBot({ direccion, red: 'github', usuario: 'ladron', chainId: CHAIN });
    const otraDireccion = componerBot({
      direccion: ladron.address,
      red: 'github',
      usuario: 'marta',
      chainId: CHAIN,
    });
    const otraRed = componerBot({ direccion, red: 'github', usuario: 'marta', chainId: 10143 });

    for (const [nombre, texto] of [
      ['pegada en otra cuenta', otraCuenta],
      ['usada desde otra dirección', otraDireccion],
      ['traída de otra red', otraRed],
    ] as const) {
      const quien = await recoverMessageAddress({ message: texto, signature: firma });
      check(nombre, quien.toLowerCase() !== direccion.toLowerCase(), quien);
    }
  }

  console.log('');
  if (fallos === 0) console.log('✅ La prueba de cuenta cuadra en las dos capas');
  else {
    console.error(`❌ ${fallos} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
