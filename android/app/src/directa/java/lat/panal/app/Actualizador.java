package lat.panal.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * Bajar la versión nueva DENTRO de la app y abrir el instalador de Android.
 *
 * ANTES, el aviso del menú abría el APK en el navegador: se descargaba a la
 * carpeta de descargas y había que ir a buscarlo y abrirlo a mano. Ahora la
 * app lo baja ella misma, lo comprueba y le pasa el archivo al instalador del
 * sistema. Un toque y la pantalla de «¿Quieres actualizar esta app?».
 *
 * LO QUE NO HACE: instalar sola. No puede, y no debe. Una app normal no tiene
 * forma de instalar nada sin que la persona lo confirme en la pantalla del
 * sistema, y eso se queda así: Android pide permiso para instalar desde Panal
 * la primera vez, y pide confirmar cada actualización.
 *
 * SOLO SE INSTALA LO QUE FIRMÓ LA MISMA CLAVE QUE ESTA APP. Antes de abrir el
 * instalador se comprueba, con el archivo ya en el teléfono:
 *
 *   · que es un APK que Android sabe leer,
 *   · que es ESTA app (`lat.panal.app`) y no otra,
 *   · que lo firmó exactamente la misma clave que firmó la app instalada,
 *   · que es la versión que se pidió y que es más nueva que la instalada.
 *
 * Lo de la firma Android lo vuelve a comprobar al actualizar, y rechazaría un
 * APK firmado con otra clave. Pero NO lo comprueba si el paquete es otro: un
 * APK de otra app con otro nombre se instalaría como app nueva, con la
 * pantalla de instalar delante y el nombre que quisiera. Si alguien llegara a
 * cambiar el archivo del servidor, eso es lo que intentaría, y es lo que esto
 * corta antes de que se vea nada.
 *
 * La URL no viene de la página: se arma aquí con un número `n.n.n` validado, en
 * nuestro dominio, por HTTPS. Desde JavaScript solo se puede pedir «instala la
 * versión X», nunca «instala este archivo».
 *
 * Solo existe en la variante DIRECTA (está en `src/directa/`): Google Play no
 * deja que una app se actualice por fuera de Play, y el permiso que esto
 * necesita (`REQUEST_INSTALL_PACKAGES`) se declara solo en el manifiesto de
 * esa variante.
 */
@CapacitorPlugin(name = "Actualizador")
public class Actualizador extends Plugin {

    /** De dónde se baja. La misma copia con número que anuncia `ultima.json`. */
    private static final String ORIGEN = "https://panalandroid.panal.lat/panal-apk-v";

    /** `2.33.0`. Nada de rutas, ni barras, ni puntos de más. */
    private static final Pattern VERSION = Pattern.compile("^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$");

    /** El APK pesa unos 4 MB. Esto es el tope para no llenar el teléfono si el servidor se vuelve loco. */
    private static final long TOPE_BYTES = 64L * 1024 * 1024;

    private static final String CARPETA = "actualizacion";

    /**
     * Un hilo propio y no el de los plugins: Capacitor atiende TODOS los
     * plugins en el mismo hilo, y una descarga de 4 MB con mala cobertura lo
     * dejaría ocupado —el llavero, los avisos— todo lo que tarde.
     */
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();

    private final AtomicBoolean ocupado = new AtomicBoolean(false);

    /** Un fallo con su código, que la página traduce a una frase. */
    private static final class Rechazo extends Exception {
        final String codigo;

        Rechazo(String mensaje, String codigo) {
            super(mensaje);
            this.codigo = codigo;
        }
    }

    /**
     * Al arrancar, se borra lo que ya no sirve: el APK de la versión que ya
     * está instalada (o de una anterior) y las descargas a medias.
     *
     * No se borra un APK MÁS NUEVO que la instalada: si la persona lo bajó y
     * canceló el instalador, tocar otra vez lo abre sin volver a bajarlo.
     */
    @Override
    public void load() {
        hilo.execute(this::limpiar);
    }

    @Override
    protected void handleOnDestroy() {
        hilo.shutdownNow();
    }

    @PluginMethod
    public void instalar(PluginCall call) {
        String version = call.getString("version", "");
        if (version == null || !VERSION.matcher(version).matches()) {
            call.reject("versión no válida", "VERSION");
            return;
        }
        if (!ocupado.compareAndSet(false, true)) {
            call.reject("ya hay una descarga en marcha", "OCUPADO");
            return;
        }
        hilo.execute(() -> {
            try {
                File apk = bajarYComprobar(version);
                abrirInstalador(apk);
                JSObject r = new JSObject();
                r.put("estado", "instalador");
                call.resolve(r);
            } catch (Rechazo e) {
                call.reject(e.getMessage(), e.codigo);
            } catch (IOException | RuntimeException e) {
                // Sin red, un corte a medias, el servidor caído: lo mismo para
                // quien lo lee, «no se pudo descargar, vuelve a intentarlo».
                call.reject("no se pudo descargar", "RED");
            } finally {
                ocupado.set(false);
            }
        });
    }

    /**
     * El archivo, ya comprobado.
     *
     * Si había uno guardado de antes y no pasa la comprobación, se borra y se
     * baja de nuevo UNA vez: puede ser un resto de una descarga rota. Si el
     * recién bajado tampoco pasa, se borra y se dice por qué.
     */
    private File bajarYComprobar(String version) throws IOException, Rechazo {
        File carpeta = new File(getContext().getCacheDir(), CARPETA);
        if (!carpeta.isDirectory() && !carpeta.mkdirs()) throw new IOException("sin carpeta");
        File destino = new File(carpeta, "panal-" + version + ".apk");

        if (destino.isFile() && destino.length() > 0) {
            try {
                comprobar(destino, version);
                return destino;
            } catch (Rechazo viejo) {
                borrar(destino);
            }
        }

        bajar(version, carpeta, destino);
        try {
            comprobar(destino, version);
        } catch (Rechazo e) {
            borrar(destino);
            throw e;
        }
        return destino;
    }

    private void bajar(String version, File carpeta, File destino) throws IOException, Rechazo {
        File parte = new File(carpeta, "panal-" + version + ".part");
        HttpURLConnection conexion = (HttpURLConnection) new URL(ORIGEN + version + ".apk").openConnection();
        try {
            conexion.setConnectTimeout(15_000);
            conexion.setReadTimeout(30_000);
            // Sin redirecciones: el archivo está donde se dice o no está. Una
            // redirección llevaría la descarga a un sitio que nadie eligió.
            conexion.setInstanceFollowRedirects(false);
            conexion.setRequestProperty("Accept-Encoding", "identity");

            if (conexion.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("HTTP " + conexion.getResponseCode());
            }
            long total = conexion.getContentLengthLong();
            if (total > TOPE_BYTES) throw new Rechazo("el archivo es demasiado grande", "GRANDE");

            long recibidos = 0;
            int ultimoPorcentaje = -1;
            try (
                InputStream entrada = new BufferedInputStream(conexion.getInputStream());
                OutputStream salida = new FileOutputStream(parte)
            ) {
                byte[] trozo = new byte[64 * 1024];
                int leidos;
                while ((leidos = entrada.read(trozo)) != -1) {
                    recibidos += leidos;
                    if (recibidos > TOPE_BYTES) throw new Rechazo("el archivo es demasiado grande", "GRANDE");
                    salida.write(trozo, 0, leidos);

                    // Un aviso por punto de porcentaje, no uno por trozo: cada
                    // aviso cruza el puente hasta la página.
                    int porcentaje = total > 0 ? (int) (recibidos * 100 / total) : -1;
                    if (porcentaje != ultimoPorcentaje) {
                        ultimoPorcentaje = porcentaje;
                        JSObject progreso = new JSObject();
                        progreso.put("recibidos", recibidos);
                        progreso.put("total", total);
                        notifyListeners("progreso", progreso);
                    }
                }
            }
            if (total > 0 && recibidos != total) throw new IOException("descarga incompleta");
            if (!parte.renameTo(destino)) throw new IOException("no se pudo guardar");
        } finally {
            conexion.disconnect();
            borrar(parte);
        }
    }

    /** Las cuatro comprobaciones de arriba, en orden. */
    private void comprobar(File apk, String version) throws Rechazo {
        Context contexto = getContext();
        PackageManager pm = contexto.getPackageManager();

        PackageInfo archivo = pm.getPackageArchiveInfo(apk.getAbsolutePath(), banderasDeFirma());
        if (archivo == null) throw new Rechazo("el archivo no es un APK válido", "CORRUPTO");

        if (!contexto.getPackageName().equals(archivo.packageName)) {
            throw new Rechazo("el archivo es de otra app", "OTRA_APP");
        }

        PackageInfo instalada;
        try {
            instalada = pm.getPackageInfo(contexto.getPackageName(), banderasDeFirma());
        } catch (PackageManager.NameNotFoundException e) {
            throw new Rechazo("no se encuentra la app instalada", "CORRUPTO");
        }

        Set<String> delArchivo = huellas(archivo);
        if (delArchivo.isEmpty() || !delArchivo.equals(huellas(instalada))) {
            throw new Rechazo("el archivo no lleva la firma de Panal", "FIRMA");
        }

        if (!version.equals(archivo.versionName)) {
            throw new Rechazo("el archivo no es la versión pedida", "NO_ES_NUEVA");
        }
        if (PackageInfoCompat.getLongVersionCode(archivo) <= PackageInfoCompat.getLongVersionCode(instalada)) {
            throw new Rechazo("el archivo no es más nuevo que la app instalada", "NO_ES_NUEVA");
        }
    }

    /**
     * Las dos banderas desde Android 9: la nueva da la firma con su historia,
     * y la vieja es la red por si algún fabricante deja `signingInfo` vacío al
     * leer un archivo que no está instalado.
     */
    @SuppressWarnings("deprecation")
    private static int banderasDeFirma() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES;
        }
        return PackageManager.GET_SIGNATURES;
    }

    /** La huella SHA-256 de cada certificado con el que va firmado. */
    @SuppressWarnings("deprecation")
    private static Set<String> huellas(PackageInfo info) {
        Signature[] firmas = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            SigningInfo s = info.signingInfo;
            firmas = s.hasMultipleSigners() ? s.getApkContentsSigners() : s.getSigningCertificateHistory();
        }
        if (firmas == null || firmas.length == 0) firmas = info.signatures;

        Set<String> salida = new HashSet<>();
        if (firmas == null) return salida;
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            for (Signature firma : firmas) {
                byte[] h = sha.digest(firma.toByteArray());
                StringBuilder texto = new StringBuilder(h.length * 2);
                for (byte b : h) texto.append(String.format("%02X", b));
                salida.add(texto.toString());
            }
        } catch (NoSuchAlgorithmException e) {
            salida.clear();
        }
        return salida;
    }

    /**
     * El instalador del sistema, con el archivo por el FileProvider de la app.
     *
     * Si es la primera vez, Android enseña antes su aviso de «permitir instalar
     * apps de esta fuente», con el botón para ir a los ajustes, y al volver
     * sigue con la instalación. Eso lo lleva el sistema, no esto.
     */
    private void abrirInstalador(File apk) throws Rechazo {
        Context contexto = getContext();
        Uri uri = FileProvider.getUriForFile(contexto, contexto.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                contexto.startActivity(intent);
            }
        } catch (ActivityNotFoundException e) {
            throw new Rechazo("no hay instalador en este teléfono", "INSTALADOR");
        }
    }

    private void limpiar() {
        File carpeta = new File(getContext().getCacheDir(), CARPETA);
        File[] archivos = carpeta.listFiles();
        if (archivos == null) return;
        String instalada;
        try {
            instalada = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return;
        }
        for (File f : archivos) {
            String nombre = f.getName();
            if (nombre.endsWith(".part")) {
                borrar(f);
                continue;
            }
            String v = nombre.replaceFirst("^panal-", "").replaceFirst("\\.apk$", "");
            if (!VERSION.matcher(v).matches() || !esMasNueva(v, instalada)) borrar(f);
        }
    }

    /** Número a número, como `esMasNueva` en `movil/src/lib/actualizacion.ts`. */
    private static boolean esMasNueva(String candidata, String actual) {
        if (actual == null || !VERSION.matcher(actual).matches()) return false;
        String[] a = candidata.split("\\.");
        String[] b = actual.split("\\.");
        for (int i = 0; i < 3; i++) {
            int x = Integer.parseInt(a[i]);
            int y = Integer.parseInt(b[i]);
            if (x != y) return x > y;
        }
        return false;
    }

    private static void borrar(File f) {
        if (f.exists() && !f.delete()) f.deleteOnExit();
    }
}
