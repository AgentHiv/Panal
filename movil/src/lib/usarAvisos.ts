import { useEffect, useRef } from 'react';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useWallet } from '@/hooks/useWallet';
import { esBuzon } from '@/lib/botEndpoint';
import { leerTipo } from '@panal/sdk';
import { useFicha } from '~/lib/agentes';
import { ESTADO } from '@/lib/conversaciones';
import { currencySymbol } from '@/contracts/config';
import { getTaskBrief } from '@/lib/taskBriefs';
import { AUTO_RELEASE_MS, monto } from '~/lib/formato';
import { avisosEncendidos, hayAvisos, idDe, pedirPermiso, programar } from '~/lib/avisos';
import { textos } from '~/i18n/idiomas';

/**
 * Los avisos, enganchados a las tareas que ya se leen.
 *
 * No hace ninguna consulta propia: `useMyTasks` ya sondea cada 15 s, así que
 * esto solo mira lo que llega y decide qué merece una notificación. Un aviso
 * es un efecto de lo que la app ya sabe, no una razón para preguntar más.
 *
 * Como CLIENTE, tres motivos:
 *   · ENTREGA — el agente entregó y hay algo que revisar.
 *   · CUENTA ATRÁS — quedan 6 h para que se apruebe solo. Se programa como
 *     alarma exacta en cuanto se conoce la entrega: el plazo de 3 días ya está
 *     decidido, así que no hace falta volver a preguntar nada.
 *   · PLAZO — venció sin entrega y el pago se puede recuperar.
 *
 * Como DUEÑO de un agente, tres. El primero solo si el trabajo depende de que
 * MIRES:
 *   · ENCARGO NUEVO — te han encargado algo, ahora mismo. Solo se manda a quien
 *     recibe en el buzón o se ha declarado persona, y ahí está el motivo: si
 *     tienes servidor propio, el encargo ya le llegó a él y tu bot está en
 *     ello; avisarte sería ruido. Si recibes en el buzón, el servidor eres tú,
 *     y hasta ahora no se enteraba nadie hasta las 6 h — que con el plazo más
 *     corto de la web es justo cuando el encargo ya ha vencido.
 *
 * Los otros dos existen por un fallo de verdad: el
 * vigilante que corre dentro de cada agente dio por resueltas tareas que habían
 * fallado, y dos se quedaron abiertas y sin entregar mientras el servidor creía
 * que iba todo bien. El dueño no tenía forma de enterarse, porque el único que
 * vigilaba era el proceso que había fallado.
 *   · SIN ENTREGAR — tu agente tiene un encargo abierto y el plazo corriendo.
 *     Salta a las 6 h de vida del encargo, no al vencer: avisar cuando ya no se
 *     puede hacer nada no es avisar. Los dos se reparten la línea del tiempo:
 *     «te ha entrado» de 0 a 6 h, «llevas sin entregar» a partir de ahí.
 *   · DISPUTA — te han disputado una entrega y el dinero está congelado.
 *
 * La wallet conectada es la del agente cuando se administra uno, así que
 * `useMyTasks` ya trae sus tareas con `role: 'worker'`. No hace falta ninguna
 * consulta nueva.
 *
 * `idDe` da un id estable por tarea y motivo, así que reprogramar REEMPLAZA en
 * vez de duplicar. Sin eso, cada repaso dejaría otra copia en la persiana.
 */
export function useAvisos(): void {
  const { tasks } = useMyTasks();
  const { address } = useWallet();
  const permiso = useRef<boolean | null>(null);
  const yaAvisado = useRef(new Set<number>());

  /**
   * ¿Depende de que yo mire que este encargo se haga?
   *
   * Sí cuando recibo en el buzón —el servidor soy yo— o cuando me he declarado
   * persona. No cuando tengo máquina propia: a ella le llegó el encargo y ella
   * está trabajando, así que un aviso por cada tarea sería ruido en el
   * teléfono de quien tiene un bot que entrega en segundos.
   *
   * Es la misma ficha que la pantalla ya lee, con su caché de 20 s: esto no
   * añade ni una consulta.
   */
  const { data: miFicha } = useFicha(address ?? undefined);
  const dependeDeMi =
    !!miFicha?.registrado &&
    (esBuzon(miFicha.botUrl) || leerTipo(miFicha.metadataURI) === 'persona');

  useEffect(() => {
    if (!hayAvisos() || !avisosEncendidos() || tasks.length === 0) return;

    let vigente = true;
    void (async () => {
      // `textos()` y no `useTextos()`: esto no pinta nada, y un aviso se
      // escribe en el idioma que hay puesto cuando se programa.
      const T = textos();
      if (permiso.current === null) permiso.current = await pedirPermiso();
      if (!permiso.current || !vigente) return;

      const ahora = Date.now();
      const nuevos = [];

      for (const t of tasks) {
        const id = t.id.toString();

        if (t.role === 'worker') {
          const simbolo = currencySymbol(t.currency);

          /**
           * Acaba de entrar, y aquí eso SÍ es una señal.
           *
           * Solo las primeras seis horas, que es hasta donde llega este aviso
           * antes de que lo releve el de «llevas sin entregar». Y no es un
           * detalle: sin esa ventana, abrir la app un martes anunciaría como
           * recién llegados los encargos del viernes.
           */
          const empezoHace = ahora - Number(t.createdAt) * 1000;
          if (dependeDeMi && t.status === ESTADO.Abierto && empezoHace <= 6 * 3_600_000) {
            const aviso = idDe(id, 'encargo-nuevo');
            if (!yaAvisado.current.has(aviso)) {
              yaAvisado.current.add(aviso);
              const horas = Math.max(0, Math.floor((Number(t.deadline) * 1000 - ahora) / 3_600_000));
              nuevos.push({
                id: aviso,
                titulo: T.avisos.encargoNuevoTitulo(id),
                cuerpo: T.avisos.encargoNuevoCuerpo(monto(t.amountWei), simbolo, horas),
                ruta: `/guardia/${t.worker.toLowerCase()}`,
              });
            }
          }

          // Abierto, sin nada anclado y con seis horas ya corridas. Antes de
          // eso no es una señal: es un encargo que acaba de entrar.
          const empezo = Number(t.createdAt) * 1000;
          if (t.status === ESTADO.Abierto && ahora - empezo > 6 * 3_600_000) {
            const aviso = idDe(id, 'sin-entregar');
            if (!yaAvisado.current.has(aviso)) {
              yaAvisado.current.add(aviso);
              const restan = Math.max(0, Math.floor((Number(t.deadline) * 1000 - ahora) / 3_600_000));
              nuevos.push({
                id: aviso,
                titulo: T.avisos.sinEntregarTitulo(id),
                cuerpo: restan
                  ? T.avisos.sinEntregarCuerpo(restan, monto(t.amountWei), simbolo)
                  : T.avisos.sinEntregarVencido(monto(t.amountWei), simbolo),
                ruta: `/guardia/${t.worker.toLowerCase()}`,
              });
            }
          }

          if (t.status === ESTADO.Disputado) {
            const aviso = idDe(id, 'disputa');
            if (!yaAvisado.current.has(aviso)) {
              yaAvisado.current.add(aviso);
              nuevos.push({
                id: aviso,
                titulo: T.avisos.disputaTitulo(id),
                cuerpo: T.avisos.disputaCuerpo(monto(t.amountWei), simbolo),
                ruta: `/guardia/${t.worker.toLowerCase()}`,
              });
            }
          }
          continue;
        }

        if (t.role !== 'client') continue;
        const simbolo = currencySymbol(t.currency);
        const brief = getTaskBrief(t.taskHash);

        if (t.status === ESTADO.Entregado && t.deliveredAt) {
          const entrega = idDe(id, 'entrega');
          if (!yaAvisado.current.has(entrega)) {
            yaAvisado.current.add(entrega);
            nuevos.push({
              id: entrega,
              titulo: T.avisos.entregaTitulo(id),
              cuerpo: brief ?? T.avisos.entregaCuerpo,
              ruta: `/chat/${t.worker.toLowerCase()}`,
            });
          }

          // Seis horas antes de que se libere solo. Si ya pasó, no se programa
          // nada: un aviso con fecha pasada salta al instante y asusta.
          const cuenta = idDe(id, 'cuenta-atras');
          const cuando = Number(t.deliveredAt) * 1000 + AUTO_RELEASE_MS - 6 * 3_600_000;
          if (cuando > ahora && !yaAvisado.current.has(cuenta)) {
            yaAvisado.current.add(cuenta);
            nuevos.push({
              id: cuenta,
              titulo: T.avisos.cuentaAtrasTitulo(id),
              cuerpo: T.avisos.cuentaAtrasCuerpo(monto(t.amountWei), simbolo),
              ruta: `/chat/${t.worker.toLowerCase()}`,
              cuando,
            });
          }
        }

        if (t.status === ESTADO.Abierto && Number(t.deadline) * 1000 < ahora) {
          const plazo = idDe(id, 'plazo');
          if (!yaAvisado.current.has(plazo)) {
            yaAvisado.current.add(plazo);
            nuevos.push({
              id: plazo,
              titulo: T.avisos.plazoTitulo(id),
              cuerpo: T.avisos.plazoCuerpo(monto(t.amountWei), simbolo),
              ruta: `/chat/${t.worker.toLowerCase()}`,
            });
          }
        }
      }

      if (vigente) await programar(nuevos);
    })();

    return () => {
      vigente = false;
    };
    // `dependeDeMi` va en la lista: la ficha se lee aparte y llega un momento
    // después que las tareas. Sin él, el primer encargo de la sesión se
    // quedaría sin aviso hasta el siguiente sondeo. Repasar de más no duplica
    // nada: `yaAvisado` guarda lo ya mandado.
  }, [tasks, dependeDeMi]);
}
