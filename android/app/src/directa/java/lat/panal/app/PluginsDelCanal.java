package lat.panal.app;

import com.getcapacitor.BridgeActivity;

/**
 * Los plugins que solo lleva el APK directo (`lat.panal.app`).
 *
 * Hay otro archivo con el mismo nombre en `src/play/`, vacío: la app de Google
 * Play no lleva el actualizador, porque Play no deja que una app se actualice
 * por fuera de Play, ni los enlaces con los que firma para la web, porque no
 * puede pagar consultas. Así el código ni siquiera viaja en el paquete de Play.
 */
final class PluginsDelCanal {

    private PluginsDelCanal() {}

    static void registrar(BridgeActivity actividad) {
        actividad.registerPlugin(Actualizador.class);
        actividad.registerPlugin(Enlaces.class);
    }
}
