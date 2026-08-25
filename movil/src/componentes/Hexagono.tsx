import { useState } from 'react';

/**
 * El avatar del panal. La celda es la forma de la marca, y la inicial evita
 * tener que inventarse una foto para algo que no tiene cara.
 *
 * Si el agente publicó un logo en su ficha, se pinta ese, recortado con la
 * misma celda: así una lista con logos y otra sin ellos tienen la misma
 * silueta. Y si el logo no carga —dominio caído, ruta cambiada— se vuelve a la
 * inicial sin decir nada: un hueco sería peor, y quien mira no puede hacer nada
 * al respecto porque el archivo es del agente.
 */
const TONOS = ['#E29A2E', '#836EF9', '#92A268', '#C9653B', '#B7A8FC'];

export default function Hexagono({
  semilla,
  inicial,
  tamano = 44,
  logo,
}: {
  semilla: string;
  inicial: string;
  tamano?: number;
  logo?: string;
}): React.ReactElement {
  // Determinista: el mismo agente sale siempre del mismo color.
  let suma = 0;
  for (let i = 0; i < semilla.length; i += 1) suma = (suma * 31 + semilla.charCodeAt(i)) >>> 0;
  const tono = TONOS[suma % TONOS.length];

  /**
   * Un logo que no carga deja de intentarlo y cede el sitio al generado.
   *
   * El «volver a intentarlo» cuando cambia el logo se hace AQUÍ, ajustando el
   * estado durante el render, y no en un efecto: si se hiciera en un efecto, el
   * primer pintado de un agente nuevo usaría todavía el «roto» del anterior y
   * su logo no llegaría a intentarse.
   */
  const [cual, setCual] = useState(logo);
  const [roto, setRoto] = useState(false);
  if (cual !== logo) {
    setCual(logo);
    setRoto(false);
  }

  if (logo && !roto) {
    return (
      <div
        className="shrink-0 overflow-hidden"
        style={{
          width: tamano,
          height: tamano,
          // El mismo relleno que el hexágono de abajo: un logo con
          // transparencia se apoya en el mismo fondo que la inicial.
          background: '#232035',
          // El mismo hexágono del SVG de abajo, recortando la imagen.
          clipPath: 'polygon(50% 5%, 90% 27.5%, 90% 72.5%, 50% 95%, 10% 72.5%, 10% 27.5%)',
        }}
      >
        <img
          src={logo}
          alt=""
          width={tamano}
          height={tamano}
          loading="lazy"
          decoding="async"
          // Sin `referrer`: el servidor del agente sirve la imagen y no tiene
          // por qué enterarse además de qué pantalla estaba abierta.
          referrerPolicy="no-referrer"
          onError={() => setRoto(true)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <svg width={tamano} height={tamano} viewBox="0 0 40 40" className="shrink-0" aria-hidden>
      <polygon
        points="20,2 36,11 36,29 20,38 4,29 4,11"
        fill="#232035"
        stroke={tono}
        strokeWidth="1.3"
      />
      <text
        x="20"
        y="25.5"
        textAnchor="middle"
        fontFamily="Space Grotesk, sans-serif"
        fontSize="14"
        fontWeight="700"
        fill={tono}
      >
        {inicial.toUpperCase()}
      </text>
    </svg>
  );
}
