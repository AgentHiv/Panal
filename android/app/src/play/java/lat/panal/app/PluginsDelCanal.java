package lat.panal.app;

import com.getcapacitor.BridgeActivity;

/**
 * La app de Google Play no lleva plugins propios de su canal.
 *
 * El del APK directo (`src/directa/`) registra el actualizador. Aquí no: las
 * actualizaciones de esta app las hace Google Play, y Play no deja que una app
 * se actualice por otro camino.
 */
final class PluginsDelCanal {

    private PluginsDelCanal() {}

    static void registrar(BridgeActivity actividad) {
        // Nada.
    }
}
