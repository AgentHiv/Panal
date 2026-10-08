# Revisión de seguridad del escrow v2 — 2026-10-08

Revisión hecha con el `PanalEscrowV2` ya desplegado en mainnet
(`0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9`). No cambia el contrato: comprueba
el que hay. El escrow v1 pasó una auditoría externa; el v2 hereda sus
correcciones (`test/v2/AuditFixesV2.t.sol`).

## Invariantes (Foundry)

`test/v2/PanalEscrowV2.invariants.t.sol`. Un `Handler` hace operaciones válidas
en cualquier orden —crear en MON y en $PANAL, coger del tablón, entregar,
aprobar, liberar por tiempo, disputar, resolver, resolver atascadas, cancelar,
retirar y dejar pasar el tiempo— y después de cada una se exige:

1. **El MON cuadra:** `balance(escrow) == bloqueado en tareas vivas + acreditado a todos`.
2. **El $PANAL cuadra:** lo mismo con `balanceOf(escrow)`.
3. **Lo entregado tiene huella:** toda tarea entregada o en disputa tiene `resultHash != 0`.

Resultado: **las tres se cumplen**. En local se corrió con 256 secuencias de 500
operaciones; en la CI van 128 de 200 para no alargarla. La suite entera:
265 pruebas, 0 fallos.

## Slither

`slither src/v2/PanalEscrowV2.sol --exclude-informational --exclude-optimization`
da 7 tipos de aviso. Ninguno es explotable:

| Detector | Dónde | Por qué no es un fallo |
|---|---|---|
| `reentrancy-no-eth` | `resolveDispute` | La llamada externa es a `reputation`, inmutable y desplegado por Panal, que no vuelve a llamar. Y la función es `nonReentrant` |
| `reentrancy-benign`, `reentrancy-balance` | `createTask` | El `transferFrom` es al token $PANAL, fijado en el constructor y sin ganchos de transferencia. `createTask` y todas las funciones que mueven fondos comparten el mismo cerrojo `nonReentrant` |
| `divide-before-multiply` | `resolveDispute` | Redondeo de 1 wei en el reparto de una disputa. `clientRefund = amount - workerGross`, así que no se pierde nada: lo confirman las invariantes |
| `timestamp` | plazos | Intencionado: los plazos del escrow se miden en tiempo de bloque |
| `uninitialized-local` | `workerPaid` | Vale 0 a propósito cuando el árbitro no da nada al trabajador |
| `incorrect-equality` | `registeredAt == 0` | Es el centinela de «no registrado» del registry |

Para una v3 quedaría más limpio aplicar checks-effects-interactions en
`resolveDispute`: acreditar al cliente antes de llamar a la reputación. No
cambia nada hoy, pero quita el aviso sin depender del cerrojo.

Cómo repetirlo: Slither no encuentra `forge` dentro de su imagen de Docker, así
que se corre sobre una copia de `src/` sin `foundry.toml`:

```bash
cp -r contracts/src /tmp/slither/ && cd /tmp/slither
docker run --rm -v "$PWD":/src -w /src ghcr.io/crytic/slither:latest sh -c \
  "solc-select install 0.8.24; solc-select use 0.8.24; \
   slither src/v2/PanalEscrowV2.sol --exclude-informational --exclude-optimization"
```
