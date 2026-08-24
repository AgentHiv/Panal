import { montoCuadro } from '~/lib/formato';
import { porMes, techo, variacion } from '~/lib/barras';
import type { Cuentas } from '~/lib/cuentas';
import { etiquetaIdioma, useTextos } from '~/i18n/idiomas';

/**
 * Lo cobrado mes a mes.
 *
 * SVG a mano y no una librería de gráficos. No es cabezonería: aquí hay seis
 * rectángulos y una línea, y la librería más pequeña que hace eso pesa más que
 * todo el resto de esta pantalla junta — en un paquete que ya va por 990 kB y
 * viaja dentro de un APK. Lo que una librería aporta de verdad son los ejes,
 * las escalas y la interacción, y de eso aquí no se usa nada.
 *
 * NO HAY EJE VERTICAL. Se pone la cifra del mes más alto arriba y ya: en 350
 * píxeles de ancho, cuatro marcas de eje con sus números tapan las barras y no
 * responden a ninguna pregunta que alguien se haga de verdad. Las preguntas
 * son «¿voy a más o a menos?» —eso lo dice la forma— y «¿cuánto fue el mejor
 * mes?» —eso lo dice esa cifra—.
 *
 * Los meses vacíos se dibujan como raya en la base. Saltarlos convertiría dos
 * meses parado en una racha (ver `lib/barras.ts`).
 */
export default function Barras({ cuentas }: { cuentas: Cuentas }): React.ReactElement | null {
  const T = useTextos();
  const barras = porMes(cuentas);
  if (barras.length === 0) return null;

  const mayor = techo(barras);
  const v = variacion(barras);
  // Solo con movimiento en más de un mes tiene sentido comparar.
  const conDatos = barras.filter((b) => b.neto > 0n).length;

  return (
    <div className="shrink-0 rounded-[18px] border border-line bg-cream p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold">{T.informe.grafico}</p>
        <p className="shrink-0 font-mono text-[12px] text-ink-3">{montoCuadro(mayor)}</p>
      </div>

      {/* `items-end` para que crezcan desde abajo, que es de donde crece el
          dinero. `h-[96px]` fijo: sin altura la barra al 100 % no tiene contra
          qué medirse y todas salen del mismo tamaño. */}
      <div className="mt-3.5 flex h-[96px] items-end gap-1.5">
        {barras.map((b) => (
          <div key={b.clave} className="flex h-full grow basis-0 flex-col justify-end">
            <div
              className={`w-full rounded-t-[4px] ${b.neto > 0n ? 'bg-honey' : 'bg-line'}`}
              style={{
                // Mínimo de 2 px para que un mes vacío se vea como una raya y
                // no como un hueco: un hueco parece que falta el dato.
                height: b.neto > 0n ? `${Math.max(6, b.alto * 100)}%` : '2px',
              }}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-1.5">
        {barras.map((b) => (
          <p
            key={b.clave}
            className={`grow basis-0 text-center text-[10.5px] ${
              b.neto > 0n ? 'text-ink-3' : 'text-line'
            }`}
          >
            {mesCorto(b.anio, b.mes)}
          </p>
        ))}
      </div>

      <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-[1.5] text-ink-3">
        {conDatos < 2
          ? T.informe.unSoloMes
          : v === null || Math.abs(v) < 0.005
            ? T.informe.igual
            : v > 0
              ? T.informe.subio(pct(v))
              : T.informe.bajo(pct(-v))}
      </p>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-3">
        {T.informe.graficoPie(cuentas.moneda)}
      </p>
    </div>
  );
}

/** «ago», «ene» — en el idioma puesto, que en chino es «8月». */
function mesCorto(anio: number, mes: number): string {
  return new Date(anio, mes - 1, 1).toLocaleDateString(etiquetaIdioma(), { month: 'short' });
}

/** Sin decimales por encima del 10 %: «+143 %» se lee, «+143,2 %» no aporta. */
function pct(v: number): string {
  const n = v * 100;
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace('.', ',');
}
