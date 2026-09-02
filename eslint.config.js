import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` a secas solo tapaba el de la raíz, así que se lintaba el JS
  // COMPILADO de los paquetes —sdk/dist, mcp/dist— y saltaban errores sobre
  // código que nadie escribe a mano: uno de ellos era un `eslint-disable` de
  // una regla de TypeScript dentro de un .js, que ahí ni existe.
  globalIgnores(['dist', '**/dist', 'movil/android', 'movil/ios']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Dos convenciones que ya usa el código y que la regla no conocía:
      //
      //   - `{ ratingSum: _ratingSum, ...rest }` es como se quita un campo de
      //     un objeto. La variable existe para NO usarla; que sobre es el
      //     punto, no un descuido.
      //   - Un `_` delante dice «esto lo dejo a propósito», y aquí se escribía
      //     ya así esperando que se respetara.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // shadcn/ui vive aquí: son componentes copiados de upstream y escritos con
    // su estilo, no con el nuestro. Lintarlos a nuestras reglas produce ruido
    // que no vamos a arreglar —arreglarlo rompe la próxima actualización— y un
    // baseline ruidoso deja de servir para nada.
    //
    // Y no es teoría: 18 errores "de siempre" escondían un hook detrás de un
    // return condicional que dejó el panel en negro en producción. Se
    // comprobaba el NÚMERO cada vez y nunca el contenido. Con estas reglas
    // apagadas donde no aplican, lo que quede es señal.
    //
    // Se apagan solo las tres que disparan, no todas: un error de verdad en un
    // componente que sí se usa tiene que seguir saltando.
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/hooks/use-mobile.ts'],
    rules: {
      // Exigir que un archivo exporte solo componentes: es una comodidad del
      // recargado en caliente, sin efecto en producción, y shadcn exporta el
      // componente junto a sus variantes por diseño.
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
])
