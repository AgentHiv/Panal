/**
 * Dar acceso a quien decide la disputa de una tarea directa con una persona
 * que recibe en el buzón de Panal.
 *
 * Si el encargo o la entrega van cifrados, ni Panal ni los firmantes de la
 * multisig pueden leerlos: decidirían a ciegas. Una parte, que sí puede, les
 * envuelve la clave de cada cosa (`darAccesoALosArbitrosDeUnaTarea`) y el
 * buzón se la sirve a ellos solos mientras dure la disputa.
 *
 * Con un agente que tiene servidor propio no hay nada que hacer aquí: lo
 * suyo vive en su máquina, no en el buzón.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSignMessage } from 'wagmi';
import { toast } from 'sonner';
import { esTextoCifrado } from '@panal/sdk';
import type { Address } from 'viem';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { useWallet } from '@/hooks/useWallet';
import type { RealTask } from '@/hooks/useMyTasks';
import { darAccesoALosArbitrosDeUnaTarea } from '@/lib/accesos';
import { hayEntrega } from '@/lib/expedientes';
import { esBuzon } from '@/lib/botEndpoint';
import { clavePublicaDe } from '@/lib/cifrado';
import { getTaskSobre } from '@/lib/taskBriefs';

export function useAccesoEnDisputa() {
  const { t } = useTranslation();
  const { address } = useWallet();
  const { agents } = usePanalAgents();
  const { signMessageAsync } = useSignMessage();
  const [dando, setDando] = useState<bigint | null>(null);

  /** El buzón de quien trabaja en esta tarea, si recibe ahí. */
  const buzonDe = useCallback(
    (task: RealTask): string | null => {
      const url = agents.find((a) => a.workerAddress.toLowerCase() === task.worker.toLowerCase())?.botUrl ?? null;
      return esBuzon(url) ? url : null;
    },
    [agents],
  );

  /**
   * Da acceso. Con `soloSiCifrado` —justo después de abrir la disputa— no
   * pide ninguna firma si no hay señal de que algo vaya cifrado: ni el sobre
   * que guardó el cliente ni una clave suya publicada, que es lo que hace que
   * le cifren la entrega.
   */
  const dar = async (task: RealTask, { soloSiCifrado = false }: { soloSiCifrado?: boolean } = {}): Promise<void> => {
    const botUrl = buzonDe(task);
    if (!botUrl || !address) return;
    const yo = address as Address;
    const sobre = getTaskSobre(task.taskHash);
    if (soloSiCifrado && !(sobre && esTextoCifrado(sobre)) && !(await clavePublicaDe(yo))) return;
    setDando(task.id);
    try {
      const r = await darAccesoALosArbitrosDeUnaTarea({
        botUrl,
        taskId: task.id,
        taskHash: task.taskHash,
        resultHash: hayEntrega(task.resultHash) ? task.resultHash : null,
        rol: task.role,
        sobreGuardado: sobre,
        yo,
        firmar: (message) => signMessageAsync({ message }),
      });
      if (r.objetos === 0) {
        if (!soloSiCifrado) toast(t('dashReal.dispute.nadaCifrado'));
      } else if (r.arbitros > 0) {
        toast.success(t('dashReal.dispute.accesoDado', { n: r.arbitros, total: r.arbitros + r.sinClave.length }));
      } else {
        toast.error(t('dashReal.dispute.accesoNo'), { description: t('dashReal.dispute.arbitrosSinClave') });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('dashReal.dispute.accesoNo'), {
        description: /user (rejected|denied)/i.test(msg) ? t('hire.step3.rejected') : msg.split('\n')[0],
      });
    } finally {
      setDando(null);
    }
  };

  return { buzonDe, dar, dando };
}
