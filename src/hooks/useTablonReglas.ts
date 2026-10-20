/**
 * Las lecturas del tablón con reglas, con react-query. Compartidas por la web
 * y la app; lo que leen y cómo está en `lib/tablonReglas.ts`.
 *
 * UNA CONSULTA PARA LO GRANDE. Los encargos, sus anuncios, sus ofertas y las
 * tareas del escrow de los tuyos salen juntos: se leen en bloque (Multicall3),
 * y partirlos solo multiplicaría las peticiones al RPC público.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Address } from 'viem';
import { EstadoTablon, ModoTablon, leerAnuncio, type AudienciaTablon, type EncargoConReglas, type OfertaConReglas } from '@panal/sdk';
import { activeChain } from '@/contracts/config';
import {
  leerAnuncios,
  leerDeuda,
  leerEncargos,
  leerOfertas,
  leerPermisos,
  leerReglas,
  leerSituacion,
  leerTareas,
  type TareaDelTablon,
} from '@/lib/tablonReglas';

export interface DatosDelTablon {
  encargos: EncargoConReglas[];
  /**
   * Por número de encargo; solo los que cuadran con su `advertHash`. Sin la
   * marca de audiencia (`para:personas · `): esa va en `audiencias`.
   */
  anuncios: Map<string, string>;
  /** Por número de encargo, los que son solo para personas o solo para agentes. */
  audiencias: Map<string, AudienciaTablon>;
  /** Por número de encargo; solo los de selección que siguen publicados. */
  ofertas: Map<string, OfertaConReglas[]>;
  /** Por id de tarea del escrow; solo las de encargos tuyos (cliente o agente). */
  tareas: Map<string, TareaDelTablon>;
  /**
   * Por número de encargo, los CONFIDENCIALES: su encargo va cifrado, y solo
   * lo lee su cliente y quien él elija (que tiene que tener su clave publicada).
   */
  confidenciales: Set<string>;
}

const CLAVE = ['tablon-reglas', activeChain.id] as const;

/** Para refrescar todo el tablón después de firmar algo. */
export function useRefrescarTablon(): () => void {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: CLAVE });
}

export function useTablonReglas(yo: Address | null) {
  const yoLc = yo?.toLowerCase() ?? null;
  return useQuery({
    queryKey: [...CLAVE, 'encargos', yoLc],
    staleTime: 15_000,
    refetchInterval: 45_000,
    queryFn: async (): Promise<DatosDelTablon> => {
      const encargos = await leerEncargos();
      const deSeleccion = encargos
        .filter((j) => j.estado === EstadoTablon.Publicado && j.modo === ModoTablon.Seleccion)
        .map((j) => j.id);
      const misTareas = yoLc
        ? encargos
            .filter(
              (j) =>
                (j.estado === EstadoTablon.Asignado || j.estado === EstadoTablon.Cerrado) &&
                (j.cliente.toLowerCase() === yoLc || j.agente.toLowerCase() === yoLc),
            )
            .map((j) => j.escrowTaskId)
        : [];
      const [crudos, ofertas, tareas] = await Promise.all([
        // Sin buzón el tablón sigue: los encargos salen sin su texto.
        leerAnuncios(encargos).catch(() => ({ anuncios: new Map<string, string>(), confidenciales: new Set<string>() })),
        leerOfertas(deSeleccion),
        leerTareas(misTareas),
      ]);
      // El hash ya se comprobó sobre el anuncio entero; aquí se parte en para
      // quién es y lo que se enseña.
      const anuncios = new Map<string, string>();
      const audiencias = new Map<string, AudienciaTablon>();
      for (const [id, anuncio] of crudos.anuncios) {
        const { audiencia, texto } = leerAnuncio(anuncio);
        anuncios.set(id, texto);
        if (audiencia !== 'todos') audiencias.set(id, audiencia);
      }
      return { encargos, anuncios, audiencias, ofertas, tareas, confidenciales: crudos.confidenciales };
    },
  });
}

/** Topes de la beta, mínimos y plazos del escrow. Cambian muy de vez en cuando. */
export function useReglasDelTablon() {
  return useQuery({
    queryKey: [...CLAVE, 'reglas'],
    queryFn: leerReglas,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useSituacionEnElTablon(agente: Address | null) {
  return useQuery({
    queryKey: [...CLAVE, 'situacion', agente?.toLowerCase() ?? null],
    enabled: !!agente,
    queryFn: () => leerSituacion(agente as Address),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

/** Lo que el tablón le debe a esta dirección, por moneda. */
export function useDeudaDelTablon(quien: Address | null) {
  return useQuery({
    queryKey: [...CLAVE, 'deuda', quien?.toLowerCase() ?? null],
    enabled: !!quien,
    queryFn: () => leerDeuda(quien as Address),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

/** `canTake` de este agente en cada encargo abierto. */
export function usePermisosEnElTablon(agente: Address | null, ids: bigint[]) {
  const clave = ids.map(String).join(',');
  return useQuery({
    queryKey: [...CLAVE, 'permisos', agente?.toLowerCase() ?? null, clave],
    enabled: !!agente && ids.length > 0,
    queryFn: () => leerPermisos(agente as Address, ids),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}
