/**
 * Panal — qué wallets se le ofrecen a quien pulsa "Conectar".
 *
 * Parece una lista y es la puerta de entrada: si aquí sobra una entrada, el
 * usuario pulsa un botón que no puede funcionar; si falta, no puede entrar.
 *
 * Hay dos familias, y las dos hacen falta:
 *
 *   - INYECTADAS. MetaMask, Trust Wallet, Rabby… Existen solo si algo las ha
 *     puesto en la página: una extensión de escritorio, o el navegador propio
 *     de una wallet. Llegan por EIP-6963 o por conector dirigido.
 *   - WALLETCONNECT. No depende de nada inyectado, y es la única que sirve en
 *     el Chrome o el Safari de un teléfono.
 *
 * Vive fuera del componente para poder probarla: el orden y las exclusiones de
 * aquí abajo se razonan mal leyendo JSX.
 */

/** ID del injected genérico (window.ethereum sin objetivo concreto). */
export const GENERIC_INJECTED_ID = 'injected';
/** ID del conector de WalletConnect. */
export const WALLETCONNECT_ID = 'walletConnect';

/** Lo que se necesita de un conector para decidir si se ofrece. */
export interface ConectorOfrecible {
  id: string;
  name: string;
  icon?: string | undefined;
}

/**
 * Las wallets que se pueden ofrecer, en el orden en que se enseñan.
 *
 * @param conectores    Los de wagmi, tal cual.
 * @param hayInyectada  Si de verdad hay un `window.ethereum` detrás.
 */
export function elegirWallets<T extends ConectorOfrecible>(conectores: readonly T[], hayInyectada: boolean): T[] {
  const wc = conectores.filter((c) => c.id === WALLETCONNECT_ID);
  const inyectados = conectores.filter((c) => c.id !== WALLETCONNECT_ID);

  // Deduplicadas por nombre: Trust Wallet puede llegar por EIP-6963 y por su
  // conector dirigido a la vez. Se prefiere la que trae icono, que es la
  // descubierta y la que el usuario reconoce de un vistazo.
  const porNombre = new Map<string, T>();
  for (const c of inyectados) {
    if (c.id === GENERIC_INJECTED_ID) continue;
    const clave = c.name.trim().toLowerCase();
    const previa = porNombre.get(clave);
    if (!previa || (!previa.icon && c.icon)) porNombre.set(clave, c);
  }
  const especificas = [...porNombre.values()];

  // El injected genérico es el último recurso: solo si no hay ninguna wallet
  // con nombre, y solo si hay algo inyectado de verdad. El conector existe
  // SIEMPRE en la lista de wagmi, aunque no haya nada detrás, y ofrecerlo
  // entonces es ofrecer un botón que lanza ConnectorNotFoundError.
  const detectadas =
    especificas.length > 0
      ? especificas
      : hayInyectada
        ? inyectados.filter((c) => c.id === GENERIC_INJECTED_ID)
        : [];

  // WalletConnect al final, a propósito: quien tiene su wallet en este mismo
  // navegador no debería tener que buscarla debajo de un QR.
  return [...detectadas, ...wc];
}
