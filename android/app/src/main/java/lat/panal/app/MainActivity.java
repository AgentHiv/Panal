package lat.panal.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * Panal para Android.
 *
 * Dos cosas: el botón ATRÁS y el registro del plugin que tapa la pantalla
 * cuando hay una semilla a la vista (`Pantalla.java`).
 *
 * Lo del botón atrás: Capacitor no lo conecta con la historia de la web, así
 * que sin esto atrás cierra la app entera desde cualquier pantalla —estés en
 * la ficha de un agente o a mitad de contratar—, que es la diferencia entre
 * una app y un acceso directo.
 *
 * Se resuelve en Java y no con el plugin `@capacitor/app` a propósito: la app
 * carga panal.lat como web remota, y depender de que el puente de JavaScript
 * llegue hasta allí es una pieza más que puede no estar. El WebView sabe si
 * puede retroceder sin preguntarle a nadie.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ANTES de `super.onCreate`: el puente de Capacitor se monta ahí
        // dentro, y un plugin registrado después no existe para la página.
        registerPlugin(Pantalla.class);

        super.onCreate(savedInstanceState);

        // Depuración remota del WebView, siempre.
        //
        // Sin esto, una pantalla en negro dentro de la app no se puede
        // diagnosticar de ninguna forma: no hay consola, no hay mensaje, y
        // desde fuera es indistinguible de que la app no arranque. Con esto,
        // `chrome://inspect` desde un ordenador con el teléfono conectado
        // enseña la consola de la página como si fuera una pestaña más.
        //
        // Android ya lo activa solo en compilaciones de depuración, pero
        // ponerlo explícito hace que siga sirviendo el día que se firme una
        // release, que es justo cuando cuesta más averiguar qué pasó.
        WebView.setWebContentsDebuggingEnabled(true);

        // El dispatcher y no `onBackPressed()`: ese está desaprobado y con el
        // gesto predictivo de Android moderno deja de llamarse.
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                            return;
                        }
                        // Nada atrás en la web: que atrás haga lo de siempre y
                        // salga de la app. Se desactiva esta callback para no
                        // interceptar la nuestra propia y quedarnos en bucle.
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                    }
                }
            );
    }
}
