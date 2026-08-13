# PanalMultisig — arbitraje 2-de-3 para PanalEscrowV2

`src/PanalMultisig.sol` es un multisig **2-de-3 minimalista y zero-dependencies**
(mismo estilo que los contratos v1/v2: sin imports externos, natspec, comentarios
en español) diseñado para ocupar el rol de `arbitrator` de
[`PanalEscrowV2`](./src/v2/PanalEscrowV2.sol)
(mainnet: [`0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9`](https://monadscan.com/address/0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9)).

## Desplegado en Monad mainnet

```
multisig    0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0    (arbitrator del EscrowV2)

owners[0]   0x69D084926e68af78cDa512eF1Bf2c3e7B4307CBf
owners[1]   0xc549eB590563e317a6159DC7624d2AF48b056ED5
owners[2]   0x1227BDB6188D4700AaE6eA02E3a128832D0FE2cF
REQUIRED    2
```

Es también el `owner` y la `tesoreria` de
[`PanalNames`](./src/PanalNames.sol), desplegado el 2026-08-14:

```
PanalNames  0xc94a8107C87859cAd2E472e71BbE25c15cdD614A   (bloque 95750662)
```

Mover una tarifa o la tesorería de los nombres exige, por tanto, dos firmas.

### Cómo sacarla de la cadena, sin fiarte de este archivo

La fuente de verdad es el escrow, no un documento:

```bash
cast call 0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9 \
  "arbitrator()(address)" --rpc-url https://rpc.monad.xyz
```

### Y cómo comprobar que ESO es un multisig

Que una dirección tenga código no basta. Se le pregunta por algo que solo
`PanalMultisig` tiene:

```bash
cast call <direccion> "txCount()(uint256)"  --rpc-url https://rpc.monad.xyz
cast call <direccion> "REQUIRED()(uint8)"   --rpc-url https://rpc.monad.xyz
cast call <direccion> "owners(uint256)(address)" 0 --rpc-url https://rpc.monad.xyz
```

Si las tres responden, es el multisig. Si revierten, no lo es por mucho que
lo parezca.

### CUIDADO: hay dos direcciones que se confunden con esta

```
0x6073443C233382613622F3400447a26c9eC6b7B4   el monedero del deployer
0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B   la cuenta inteligente ERC-4337
                                             en la que ese monedero delega
```

El monedero **tiene código** —23 bytes que empiezan por `0xef0100`—, que es la
marca de EIP-7702: dice "esta cuenta se comporta como el contrato de ahí", no
"esta cuenta es ese contrato". Por debajo sigue firmando una sola clave.

`0x63c0c19a…` sí es un contrato de verdad, pero es la implementación del
proveedor de la wallet, compartida por muchas cuentas. No es de Panal, no sabe
nada del protocolo y nadie puede hacerle firmar nada: **ponerla como `owner` de
algo lo congela para siempre**.

Por eso `script/DeployNames.s.sol` rechaza cualquier `OWNER` cuyo código empiece
por `0xef0100`. Comprobar `code.length > 0` no sirve desde EIP-7702, y dos de
los tres firmantes de este multisig son monederos 7702.

## Propósito

Hoy el `arbitrator` del EscrowV2 es **una sola EOA**: la clave que firma
`resolveDispute(taskId, workerPct, rating)` es un **punto único de fallo** —
si se pierde, las disputas quedan congeladas hasta el `DISPUTE_TIMEOUT` (14 días);
si se compromete, el atacante reparte los fondos de cualquier disputa a su antojo.

Con el multisig como arbitrator, resolver una disputa exige el acuerdo de
**2 de 3 owners**, eliminando el single point of failure sin añadir dependencias
ni cambiar una línea del EscrowV2 ya desplegado (basta `transferArbitrator`).

## ¿Por qué 2-de-3?

- **Tolerancia a 1 fallo**: con 3 owners, perder UNA clave (o que un owner esté
  indisponible) no bloquea el arbitraje — los otros dos siguen pudiendo resolver.
- **Resistencia a 1 compromiso**: una sola clave robada NO puede ejecutar nada;
  el atacante necesitaría comprometer 2 claves independientes.
- **Simplicidad operativa**: 2-de-3 es el esquema más chico que cumple ambas
  propiedades. Más owners = más coordinación para cada disputa.
- Los 3 owners se fijan en el constructor y son **inmutables**: cambiar el set
  de owners = desplegar un multisig nuevo y repetir `transferArbitrator`
  (decisión deliberada: cero superficie de administración dentro del contrato).

## Diseño (por qué sin librerías)

El proyecto es **zero-dependencies** (los contratos v1/v2 no importan nada externo;
hasta el ERC-20 es una interfaz mínima inline). El multisig sigue esa línea:

- ~120 líneas auditables de un vistazo, sin OpenZeppelin ni Safe.
- `struct Tx { target, data, confirmations, executed }` + mapping de confirmaciones.
- `submit` **no confirma automáticamente**: ejecutar siempre exige dos `confirm`
  de owners distintos (el mapping impide confirmar dos veces).
- **Checks-effects-interactions**: `executed = true` antes del `target.call`.
- Si el call destino revierte, todo revierte y la tx **queda NO ejecutada**
  (se puede reintentar la confirmación o proponer una tx nueva).
- Eventos `Submit/Confirm/Revoke/Execute` para trazabilidad off-chain.

## Flujo operativo de una disputa

1. Cliente o worker abre disputa en el escrow (`openDispute(taskId)`), tras la entrega.
2. **Owner A** propone la resolución:

   ```bash
   # workerPct en basis points: 6000 = 60% al worker, 40% reembolso al cliente
   DATA=$(cast calldata "resolveDispute(uint256,uint256,uint8)" <TASK_ID> 6000 4)
   cast send $MULTISIG "submit(address,bytes)" $ESCROW_V2 $DATA \
     --rpc-url $RPC --private-key $KEY_OWNER_A
   # Anotar el txId del evento Submit (o de `cast call $MULTISIG "txCount()" - 1`)
   ```

3. **Owner A confirma** su propia propuesta:

   ```bash
   cast send $MULTISIG "confirm(uint256)" <TX_ID> \
     --rpc-url $RPC --private-key $KEY_OWNER_A
   ```

4. **Owner B revisa** (puede leer la tx propuesta on-chain) **y confirma**;
   esta segunda confirmación **ejecuta** `resolveDispute` en el escrow:

   ```bash
   # Revision previa (view):
   cast call $MULTISIG "getTx(uint256)(address,bytes,uint8,bool)" <TX_ID> --rpc-url $RPC
   cast call $MULTISIG "isConfirmedBy(uint256,address)(bool)" <TX_ID> <OWNER_A> --rpc-url $RPC

   # Confirmar = ejecutar al llegar a 2:
   cast send $MULTISIG "confirm(uint256)" <TX_ID> \
     --rpc-url $RPC --private-key $KEY_OWNER_B
   ```

5. Verificar en el escrow:

   ```bash
   cast call $ESCROW_V2 "tasks(uint256)(address,address,uint256,bytes32,bytes32,uint256,uint256,uint8,address)" <TASK_ID> --rpc-url $RPC
   # status debe ser 2 (Completed)
   ```

Si un owner se arrepiente antes de la ejecución: `revoke(txId)` retira su
confirmación (`cast send $MULTISIG "revoke(uint256)" <TX_ID> ...`).

## Plan de migración (deploy → transferArbitrator)

1. **Deploy del multisig** (no toca el escrow):

   ```bash
   cd contracts
   OWNER_A=0x... OWNER_B=0x... OWNER_C=0x... PRIVATE_KEY=0x... \
     forge script script/DeployMultisig.s.sol --rpc-url $RPC --broadcast
   ```

2. **Verificar** los 3 owners on-chain:

   ```bash
   cast call $MULTISIG "owners(uint256)(address)" 0 --rpc-url $RPC
   cast call $MULTISIG "owners(uint256)(address)" 1 --rpc-url $RPC
   cast call $MULTISIG "owners(uint256)(address)" 2 --rpc-url $RPC
   ```

3. **Transferir el rol de árbitro** (lo puede llamar el arbitrator o el owner
   actual del escrow). Con el script (opt-in):

   ```bash
   OWNER_A=0x... OWNER_B=0x... OWNER_C=0x... PRIVATE_KEY=0x... \
   ESCROW_V2=0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9 TRANSFER_KEY=0x... \
     forge script script/DeployMultisig.s.sol --rpc-url $RPC --broadcast
   ```

   O a mano con cast:

   ```bash
   cast send 0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9 \
     "transferArbitrator(address)" $MULTISIG \
     --rpc-url $RPC --private-key <KEY_DEL_ARBITRATOR_U_OWNER_ACTUAL>
   ```

4. **Verificar**:

   ```bash
   cast call $ESCROW_V2 "arbitrator()(address)" --rpc-url $RPC   # == $MULTISIG
   ```

> **AVISO**: una vez ejecutado `transferArbitrator(multisig)`, la EOA anterior
> **ya no puede resolver disputas** (`resolveDispute` exige
> `msg.sender == arbitrator`). Toda resolución futura pasa por el flujo
> submit + confirm×2 del multisig. El owner del escrow conserva la capacidad de
> llamar `transferArbitrator` de nuevo (p. ej. para rotar a otro multisig).

## Riesgos y consideraciones

- **Owners inmutables**: si 2 de 3 claves se pierden, el multisig queda inerte
  y habría que desplegar uno nuevo + `transferArbitrator` (lo puede hacer el
  owner del escrow). Custodiar las 3 claves en entornos independientes.
- **Latencia operativa**: cada disputa requiere 3 transacciones (submit + 2
  confirms) y coordinación humana entre 2 owners; el `DISPUTE_TIMEOUT` de 14
  días sigue siendo la red de seguridad (`resolveStuckDispute`).
- **Conflicto de interés**: un owner del multisig no debería ser parte
  (cliente/worker) de la disputa que resuelve — política off-chain, no
  enforceable on-chain sin más complejidad.
- **Sin timelock**: la 2ª confirmación ejecuta de inmediato; la revisión humana
  ocurre entre el submit y el segundo confirm.

## Tests

`test/PanalMultisig.t.sol`: flujo feliz, 1 confirmación no ejecuta, revoke,
permisos (no-owner), doble ejecución, call fallido que revierte sin marcar
`executed` (con reintento exitoso), e **integración real**: protocolo v2 completo
(RegistryV2 + Reputation + EscrowV2) con el multisig de arbitrator resolviendo
una disputa end-to-end, y la migración `transferArbitrator` desde una EOA.

```bash
forge test --match-contract PanalMultisigTest -vvv
```
