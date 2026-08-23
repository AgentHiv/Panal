import { useEffect, useRef } from 'react';
import { useMyTasks } from '@/hooks/useMyTasks';
import { ESTADO } from '@/lib/conversaciones';
import { currencySymbol } from '@/contracts/config';
import { getTaskBrief } from '@/lib/taskBriefs';
import { AUTO_RELEASE_MS, monto } from '~/lib/formato';
import { hayAvisos, idDe, pedirPermiso, programar } from '~/lib/avisos';

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
 * Como DUEÑO de un agente, otros dos. Existen por un fallo de verdad: el
 * vigilante que corre dentro de cada agente dio por resueltas tareas que habían
 * fallado, y dos se quedaron abiertas y sin entregar mientras el servidor creía
 * que iba todo bien. El dueño no tenía forma de enterarse, porque el único que
 * vigilaba era el proceso que había fallado.
 *   · SIN ENTREGAR — tu agente tiene un encargo abierto y el plazo corriendo.
 *     Salta a las 6 h de vida del encargo, no al vencer: avisar cuando ya no se
 *     puede hacer nada no es avisar.
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
  const permiso = useRef<boolean | null>(null);
  const yaAvisado = useRef(new Set<number>());

  useEffect(() => {
    if (!hayAvisos() || tasks.length === 0) return;

    let vigente = true;
    void (async () => {
      if (permiso.current === null) permiso.current = await pedirPermiso();
      if (!permiso.current || !vigente) return;

      const ahora = Date.now();
      const nuevos = [];

      for (const t of tasks) {
        const id = t.id.toString();

        if (t.role === 'worker') {
          const simbolo = currencySymbol(t.currency);

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
                titulo: `Tu agente lleva sin entregar el #${id}`,
                cuerpo: restan
                  ? `Quedan ${restan} h de plazo. Si vence, el cliente recupera ${monto(t.amountWei)} ${simbolo} y no cobras.`
                  : `El plazo venció: el cliente puede recuperar ${monto(t.amountWei)} ${simbolo}.`,
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
                titulo: `Han disputado el #${id}`,
                cuerpo: `Los ${monto(t.amountWei)} ${simbolo} quedan congelados hasta que decida el árbitro.`,
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
              titulo: `Entregaron el encargo #${id}`,
              cuerpo: brief ?? 'Toca para revisar la entrega.',
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
              titulo: `Quedan 6 h para que #${id} se apruebe solo`,
              cuerpo: `Si no haces nada se pagan ${monto(t.amountWei)} ${simbolo} y cuenta como 5 estrellas.`,
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
              titulo: `#${id} venció sin entrega`,
              cuerpo: `Puedes recuperar los ${monto(t.amountWei)} ${simbolo} que bloqueaste.`,
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
  }, [tasks]);
}
