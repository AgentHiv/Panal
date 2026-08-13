import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
