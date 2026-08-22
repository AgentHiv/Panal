/**
 * El avatar del panal. La celda es la forma de la marca, y la inicial evita
 * tener que inventarse una foto para algo que no tiene cara.
 */
const TONOS = ['#E29A2E', '#836EF9', '#92A268', '#C9653B', '#B7A8FC'];

export default function Hexagono({
  semilla,
  inicial,
  tamano = 44,
}: {
  semilla: string;
  inicial: string;
  tamano?: number;
}): React.ReactElement {
  // Determinista: el mismo agente sale siempre del mismo color.
  let suma = 0;
  for (let i = 0; i < semilla.length; i += 1) suma = (suma * 31 + semilla.charCodeAt(i)) >>> 0;
  const tono = TONOS[suma % TONOS.length];

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
