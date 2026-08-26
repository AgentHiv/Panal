/**
 * Los iconos de la app, en un sitio y con la misma rejilla.
 *
 * Estaban sueltos como cadenas `d` dentro de cada pantalla, y se notaba: el de
 * «Mercado» era un trapecio abierto sin asa que en la barra de pestañas no
 * parecía nada, el de «Saldo» un rectángulo redondeado, y el mismo trapecio
 * hacía de icono del botón principal del arranque. Tres pantallas con tres
 * criterios.
 *
 * Todos van sobre 24x24 con trazo de 1,8 y remates redondos, que es lo que
 * hace que un juego de iconos parezca un juego y no una colección.
 */
const TRAZOS: Record<string, string[]> = {
  // Pestañas
  chat: ['M20.5 12a8 8 0 0 1-11.6 7.15L4 20.5l1.36-4.86A8 8 0 1 1 20.5 12Z'],
  // El asa iba POR FUERA y medía 1,4 unidades: a 21 px es un pelo, y la bolsa
  // se leía como una papelera. Va por dentro, que es como se dibuja una bolsa.
  bolsa: ['M6.6 3.2 4 7v12.2A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8V7l-2.6-3.8z', 'M4 7h16', 'M15.6 10.6a3.6 3.6 0 0 1-7.2 0'],
  cartera: [
    'M3.6 8.4A2.4 2.4 0 0 1 6 6h12A2.4 2.4 0 0 1 20.4 8.4v7.2A2.4 2.4 0 0 1 18 18H6a2.4 2.4 0 0 1-2.4-2.4z',
    'M20.4 10.5h-2.8a1.9 1.9 0 0 0 0 3.8h2.8',
  ],

  // Acciones
  mas: ['M12 5.5v13', 'M5.5 12h13'],
  buscar: ['M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M15.8 15.8 20 20'],
  atras: ['M14.5 5 8 12l6.5 7'],
  copiar: ['M9.5 9.5h9v9h-9z', 'M6.5 14.5h-1v-9h9v1'],
  fuera: ['M14 5h5v5', 'M19 5l-7.5 7.5', 'M17.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4.5'],
  cerrar: ['M6 6l12 12', 'M18 6L6 18'],
  menu: ['M4.5 7.5h15', 'M4.5 12h15', 'M4.5 16.5h15'],
  recargar: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4h-4'],
  // El galón de desplegar. Apunta abajo en reposo y la pantalla lo gira 180
  // al abrir, así que no hace falta un segundo trazo para el estado abierto.
  desplegar: ['M5.5 9.5 12 16l6.5-6.5'],

  // Estado
  escudo: ['M12 3l7.5 3.2v5c0 4.6-3.1 8.8-7.5 10-4.4-1.2-7.5-5.4-7.5-10v-5z', 'M9 12l2 2 4-4'],
  candado: ['M5.8 10.5h12.4v9H5.8z', 'M8.75 10.5V7.6a3.25 3.25 0 0 1 6.5 0v2.9'],
  reloj: ['M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z', 'M12 7.5V12l3 1.8'],
  info: ['M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z', 'M12 11v5', 'M12 7.8h.01'],
  check: ['M4.5 12.5l5 5L20 7'],

  // Archivo y llavero
  papelera: ['M5 7h14', 'M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7', 'M6.5 7l.8 11.6A1.6 1.6 0 0 0 8.9 20h6.2a1.6 1.6 0 0 0 1.6-1.4L17.5 7'],
  llave: ['M15 4.5a4.5 4.5 0 1 1-4.28 5.88L4.5 16.5V20h3.5v-2.5h2.5V15h2.1l1.12-1.12A4.5 4.5 0 0 1 15 4.5z', 'M16.6 8.4h.01'],
  // El lápiz va sobre la misma diagonal que la llave para que los dos botones
  // de la ficha de una wallet —ver las palabras, cambiarle el nombre— no
  // parezcan de dos juegos distintos.
  lapiz: ['M4.5 19.5v-3.3L15.9 4.8a1.6 1.6 0 0 1 2.3 0l1 1a1.6 1.6 0 0 1 0 2.3L7.8 19.5z', 'M14.4 6.3l3.3 3.3'],
  hoja: ['M6.5 3.5h7L18 8v12.5H6.5z', 'M13.5 3.5V8H18'],
  bajar: ['M12 4.5v11', 'M7.5 11.5 12 16l4.5-4.5', 'M5 19.5h14'],
  carpeta: ['M3.8 6.8A1.8 1.8 0 0 1 5.6 5h3.2l1.9 2.4h7.7a1.8 1.8 0 0 1 1.8 1.8v8A1.8 1.8 0 0 1 18.4 19H5.6a1.8 1.8 0 0 1-1.8-1.8z'],
  eslabon: ['M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2', 'M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2'],

  // Panal
  hexagono: ['M12 2.6 20.2 7v10L12 21.4 3.8 17V7z'],
};

export type NombreIcono = keyof typeof TRAZOS;

export default function Icono({
  nombre,
  tamano = 22,
  color = 'currentColor',
  grosor = 1.8,
  className,
}: {
  nombre: NombreIcono;
  tamano?: number;
  color?: string;
  grosor?: number;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={grosor}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {TRAZOS[nombre].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
