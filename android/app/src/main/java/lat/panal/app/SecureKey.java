package lat.panal.app;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Una segunda capa para el llavero, con una clave que no sale del chip.
 *
 * POR QUÉ HACE FALTA. El llavero se guarda cifrado con el PIN (PBKDF2 +
 * AES-GCM, en `lib/llavero.ts`). Un PIN de seis cifras son un millón de
 * combinaciones: si alguien se lleva esos datos del teléfono —uno rooteado, o
 * con un programa malicioso dentro— puede probarlas todas en un ordenador con
 * una tarjeta gráfica en cuestión de minutos, y con la wallet abierta, vaciarla.
 *
 * Aquí se vuelve a cifrar lo ya cifrado con una clave AES-256 generada DENTRO
 * del almacén de claves de Android (el chip seguro: StrongBox si el teléfono
 * lo tiene, el TEE si no). Esa clave no se puede exportar ni copiar: solo se
 * puede USAR, desde esta app y en este teléfono. Llevarse los datos ya no
 * sirve; habría que probar los PIN dentro del propio teléfono, a la velocidad
 * del teléfono, con la derivación de 310.000 vueltas en cada intento.
 *
 * NO pide huella ni bloqueo de pantalla para usarla, a propósito: con eso, un
 * cambio de huella o de patrón invalida la clave y el llavero se pierde. La
 * protección de usar la wallet sigue siendo el PIN; esto protege los datos
 * cuando salen del teléfono. Y la clave se va con la app: desinstalar borra
 * las dos cosas, que es lo que tiene que pasar.
 */
@CapacitorPlugin(name = "SecureKey")
public class SecureKey extends Plugin {

    private static final String ALMACEN = "AndroidKeyStore";
    private static final String ALIAS = "panal-llavero-v1";
    private static final int BITS_ETIQUETA = 128;

    @PluginMethod
    public void cifrar(PluginCall call) {
        String datos = call.getString("datos");
        if (datos == null) {
            call.reject("faltan los datos");
            return;
        }
        try {
            Cipher cifra = Cipher.getInstance("AES/GCM/NoPadding");
            // El IV lo elige el propio almacén: con una clave del chip no se
            // deja pasar uno de fuera, y así nunca se repite.
            cifra.init(Cipher.ENCRYPT_MODE, clave());
            byte[] salida = cifra.doFinal(Base64.decode(datos, Base64.NO_WRAP));
            JSObject r = new JSObject();
            r.put("iv", Base64.encodeToString(cifra.getIV(), Base64.NO_WRAP));
            r.put("datos", Base64.encodeToString(salida, Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("no se pudo cifrar con el almacén de claves: " + e.getClass().getSimpleName(), e);
        }
    }

    @PluginMethod
    public void descifrar(PluginCall call) {
        String iv = call.getString("iv");
        String datos = call.getString("datos");
        if (iv == null || datos == null) {
            call.reject("faltan el iv o los datos");
            return;
        }
        try {
            KeyStore almacen = KeyStore.getInstance(ALMACEN);
            almacen.load(null);
            if (!almacen.containsAlias(ALIAS)) {
                // Sin la clave no hay nada que hacer, y crearla ahora no la
                // haría coincidir con la que cifró: se dice tal cual.
                call.reject("no hay clave en el almacén");
                return;
            }
            Cipher cifra = Cipher.getInstance("AES/GCM/NoPadding");
            cifra.init(
                Cipher.DECRYPT_MODE,
                ((KeyStore.SecretKeyEntry) almacen.getEntry(ALIAS, null)).getSecretKey(),
                new GCMParameterSpec(BITS_ETIQUETA, Base64.decode(iv, Base64.NO_WRAP))
            );
            byte[] claro = cifra.doFinal(Base64.decode(datos, Base64.NO_WRAP));
            JSObject r = new JSObject();
            r.put("datos", Base64.encodeToString(claro, Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("no se pudo descifrar con el almacén de claves: " + e.getClass().getSimpleName(), e);
        }
    }

    /** La clave del llavero; se crea la primera vez que hace falta. */
    private SecretKey clave() throws Exception {
        KeyStore almacen = KeyStore.getInstance(ALMACEN);
        almacen.load(null);
        if (almacen.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) almacen.getEntry(ALIAS, null)).getSecretKey();
        }
        // StrongBox (un chip aparte) si el teléfono lo tiene; si no, el TEE.
        // Se pide y, si falla, se repite sin él: muchos teléfonos no lo traen.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return generar(true);
            } catch (Exception sinStrongBox) {
                // sigue abajo, sin StrongBox
            }
        }
        return generar(false);
    }

    private SecretKey generar(boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            spec.setIsStrongBoxBacked(true);
        }
        KeyGenerator generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ALMACEN);
        generador.init(spec.build());
        return generador.generateKey();
    }
}
