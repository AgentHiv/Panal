package lat.panal.app;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Los enlaces `panal://` y la vuelta al navegador.
 *
 * Es lo que hace falta para que la app sirva de wallet a panal.lat abierta en
 * el Chrome del teléfono (`movil/src/lib/puente.ts`):
 *
 *   - LLEGAR. La web abre `panal://wc?uri=…` para conectar y `panal://` a
 *     secas para que la app salga al frente cuando hay algo que firmar. Con la
 *     app cerrada el enlace llega en el intent con el que arranca
 *     (`inicial`); con la app ya abierta, en uno nuevo (`enlace`), porque la
 *     actividad es `singleTask` y Android no crea otra.
 *
 *   - VOLVER. Después de firmar, `volver` manda la app al fondo y queda
 *     delante lo que hubiera debajo, que es el navegador desde el que se vino.
 *     Es lo que hacen las wallets: la persona no tiene que buscar la pestaña.
 *
 * No se usa el plugin `@capacitor/app`, que lo trae hecho, porque además se
 * queda con el botón ATRÁS, y ése lo lleva `MainActivity` a propósito.
 *
 * Solo en el APK directo: la app de Google Play no puede pagar ni cobrar
 * consultas, así que tampoco firma pagos para la web.
 */
@CapacitorPlugin(name = "Enlaces")
public class Enlaces extends Plugin {

    private static final String ESQUEMA = "panal";

    /** El enlace con el que se abrió la app, una sola vez: después ya no es nuevo. */
    @PluginMethod
    public void inicial(PluginCall call) {
        JSObject r = new JSObject();
        Intent intent = getActivity() != null ? getActivity().getIntent() : null;
        String url = enlaceDe(intent);
        if (url != null) {
            r.put("url", url);
            // Gastado: si la actividad se recrea (girar la pantalla, volver de
            // segundo plano), el mismo intent no debe volver a emparejar.
            intent.setData(null);
        }
        call.resolve(r);
    }

    /** Al fondo: delante queda el navegador desde el que se vino. */
    @PluginMethod
    public void volver(PluginCall call) {
        if (getActivity() != null) getActivity().moveTaskToBack(true);
        call.resolve();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String url = enlaceDe(intent);
        if (url == null) return;
        JSObject r = new JSObject();
        r.put("url", url);
        // `true`: si la página todavía no escucha, se le guarda para cuando lo haga.
        notifyListeners("enlace", r, true);
    }

    private static String enlaceDe(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        Uri datos = intent.getData();
        if (datos == null || !ESQUEMA.equals(datos.getScheme())) return null;
        return datos.toString();
    }
}
