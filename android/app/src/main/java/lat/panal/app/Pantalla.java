package lat.panal.app;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tapar la pantalla mientras hay una semilla a la vista.
 *
 * POR QUÉ HACE FALTA BAJAR A JAVA. Las doce palabras son la wallet: quien las
 * tenga puede vaciarla desde cualquier sitio, sin el teléfono y sin el PIN. La
 * app ya evitaba mandarlas al portapapeles y no ofrece botón de copiar, pero
 * eso no sirve de nada si una captura de pantalla se las lleva igual — y una
 * captura no se queda en el teléfono: acaba en la galería, y la galería suele
 * estar sincronizada con la nube. Desde el WebView no hay forma de impedirlo:
 * la decisión la toma el sistema de ventanas de Android, no la página.
 *
 * `FLAG_SECURE` es esa decisión. Con la bandera puesta, Android:
 *
 *   · descarta la captura de pantalla y avisa de que la app no la permite,
 *   · deja en negro la grabación de pantalla y la proyección a otra pantalla,
 *   · y —esto es lo que casi nadie tiene en cuenta— tapa también la miniatura
 *     de la lista de apps recientes, donde la semilla se quedaría visible
 *     mucho después de haber salido de esa pantalla.
 *
 * SE ENCIENDE Y SE APAGA, no va puesta siempre. Una app que no deja hacer
 * capturas en ningún sitio impide contar lo que pasa: un recibo, un error, una
 * conversación con un agente. La bandera solo cubre los segundos en los que
 * hay un secreto delante, y quien la enciende es `lib/pantalla.ts`.
 *
 * `runOnUiThread` no es precaución de más: Capacitor atiende las llamadas de
 * los plugins fuera del hilo de interfaz, y tocar la ventana desde otro hilo
 * revienta con `CalledFromWrongThreadException`.
 */
@CapacitorPlugin(name = "Pantalla")
public class Pantalla extends Plugin {

    @PluginMethod
    public void proteger(PluginCall call) {
        cambiar(true);
        call.resolve();
    }

    @PluginMethod
    public void desproteger(PluginCall call) {
        cambiar(false);
        call.resolve();
    }

    private void cambiar(boolean protegida) {
        getActivity()
            .runOnUiThread(
                () -> {
                    if (protegida) {
                        getActivity()
                            .getWindow()
                            .setFlags(
                                WindowManager.LayoutParams.FLAG_SECURE,
                                WindowManager.LayoutParams.FLAG_SECURE
                            );
                    } else {
                        getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    }
                }
            );
    }
}
