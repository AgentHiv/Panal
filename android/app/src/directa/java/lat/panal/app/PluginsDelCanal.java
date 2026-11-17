package lat.panal.app;

import com.getcapacitor.BridgeActivity;

/**
 * Los plugins que solo lleva el APK directo (`lat.panal.app`).
 *
 * Hay otro archivo con el mismo nombre en `src/play/`, vacío: la app de Google
 * Play no lleva el actualizador, porque Play no deja que una app se actualice
 * por fuera de Play. Así el código ni siquiera viaja dentro del paquete de Play.
 */
final class PluginsDelCanal {

    private PluginsDelCanal() {}

    static void registrar(BridgeActivity actividad) {
        actividad.registerPlugin(Actualizador.class);
    }
}
