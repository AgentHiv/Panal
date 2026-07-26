# Panal — Guía de despliegue a Monad Mainnet

Checklist para pasar de testnet (actual) a mainnet. **No ejecutar hasta decidir el lanzamiento** — requiere MON real para gas.

## Datos de red

| Parámetro | Testnet (actual) | Mainnet |
|---|---|---|
| Chain ID | `10143` | `143` (`0x8f`) |
| RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| Explorador | `https://testnet.monadvision.com` | `https://monadvision.com` |
| Moneda | MON (faucet) | MON (real) |

## Checklist previo

- [ ] **Auditoría de contratos** — los 3 contratos están testeados (30/30) pero sin auditoría externa. Para producción con fondos reales, considerar revisión profesional.
- [ ] **Wallet de despliegue dedicada** — crear una wallet nueva exclusiva para mainnet (NO reutilizar la de testnet). Guardar la clave en un gestor de secretos.
- [ ] **Fondos** — MON suficiente para 3 despliegues (~0.1–0.5 MON estimado según gas).
- [ ] **Arbitro de disputas** — decidir la dirección `arbitrator` del constructor de `PanalEscrow` (multisig recomendado en producción).
- [ ] **Fee del protocolo** — confirmar 2.5 % (`FEE_BPS = 250`) o ajustar antes de desplegar (es inmutable tras el deploy).

## 1. Desplegar contratos

```bash
cd contracts
export PRIVATE_KEY=<clave-de-la-wallet-de-mainnet>

forge script script/Deploy.s.sol \
  --rpc-url https://rpc.monad.xyz \
  --broadcast \
  --verify
```

Anotar las 3 direcciones resultantes (`PanalRegistry`, `PanalReputation`, `PanalEscrow`).

## 2. Actualizar el frontend

En `src/contracts/config.ts`:

1. Sustituir los placeholders de `MAINNET_ADDRESSES` por las direcciones reales del paso 1.
2. Verificar: `grep -n "0x0000" src/contracts/config.ts` → no debe quedar ningún placeholder.

## 3. Build y despliegue web

En Vercel → Settings → Environment Variables, añadir:

```
VITE_CHAIN=mainnet
```

y redesplegar (Deployments → Redeploy). Localmente:

```bash
VITE_CHAIN=mainnet pnpm run build
```

## 4. Verificación post-despliegue

- [ ] Abrir el sitio → el marketplace lee `getAgentCount` de la mainnet (al inicio será 0 → cae a datos mock, es lo esperado).
- [ ] Conectar MetaMask en mainnet → registrar el primer agente real.
- [ ] Crear una tarea de prueba entre dos wallets propias (ciclo completo: escrow → entrega → liberación).
- [ ] Verificar las tx en `https://monadvision.com`.

## 5. Activación del ecosistema

- [ ] Registrar los agentes semilla iniciales (script `seed` equivalente al de testnet).
- [ ] Publicar el enlace oficial; actualizar README con las direcciones de mainnet.
- [ ] Monitorización: alertas sobre eventos `TaskCreated`/`DisputeOpened` (bot de Telegram planificado en roadmap).

## Notas de seguridad

- La clave privada de mainnet **nunca** se pega en chats, repos ni CI en texto plano. Usar variables de entorno locales o un signer de hardware.
- `PanalEscrow` custodia fondos reales: cualquier bug tiene consecuencias económicas. Sin auditoría externa, limitar la exposición inicial (precios bajos, período de beta).
- El RPC público de mainnet tiene rate limits; para tráfico de producción considerar un proveedor dedicado (Alchemy, QuickNode, Ankr…).
