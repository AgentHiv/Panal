package lat.panal.app;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

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
 * Abrir el llavero con la huella.
 *
 * QUÉ GUARDA. El PIN, cifrado con una clave AES-256 del almacén de claves de
 * Android que SOLO se deja usar justo después de poner una huella fuerte
 * (clase 3) en el diálogo del sistema. Nada más: el llavero sigue cifrado con
 * el PIN y con la clave de `SecureKey`, como siempre. La huella no es otra
 * forma de cifrar las wallets; es una forma de no teclear el PIN.
 *
 * POR QUÉ UNA CLAVE APARTE Y NO LA DE `SecureKey`. Esa no pide huella a
 * propósito: con huella, añadir un dedo nuevo al teléfono la invalida, y con
 * ella se perdería el llavero entero. Ésta sí se invalida —es lo que tiene que
 * pasar: si alguien añade su dedo, no debe poder abrir tu wallet—, pero lo
 * único que se pierde es el atajo. El PIN sigue abriendo el llavero, y desde
 * él se vuelve a activar la huella.
 *
 * Sin StrongBox, a diferencia de `SecureKey`: con claves que piden huella en
 * cada uso hay chips que fallan de formas raras, y aquí lo protegido es un PIN
 * que además solo sirve dentro de este teléfono. El TEE basta.
 *
 * El diálogo es el del sistema (`androidx.biometric`), con un botón para
 * volver al PIN. El texto lo pone la app, en su idioma.
 */
@CapacitorPlugin(name = "Huella")
public class Huella extends Plugin {

    private static final String ALMACEN = "AndroidKeyStore";
    private static final String ALIAS = "panal-huella-v1";
    private static final int BITS_ETIQUETA = 128;
    private static final int FUERTE = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    /** Un diálogo cada vez: dos seguidos se pisarían y uno no contestaría nunca. */
    private boolean enCurso = false;

    /** Si se puede usar: sensor, y al menos una huella fuerte dada de alta. */
    @PluginMethod
    public void estado(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(FUERTE);
        JSObject o = new JSObject();
        o.put("disponible", r == BiometricManager.BIOMETRIC_SUCCESS);
        o.put("sinHuellas", r == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED);
        call.resolve(o);
    }

    /**
     * Activar: clave nueva, huella, y el PIN cifrado de vuelta.
     *
     * La clave se rehace cada vez. Así una activación vieja —de antes de
     * desactivarla, o de un llavero borrado— no puede abrir nada.
     */
    @PluginMethod
    public void activar(PluginCall call) {
        String datos = call.getString("datos");
        if (datos == null) {
            call.reject("faltan los datos", "DATOS");
            return;
        }
        Cipher cifra;
        try {
            borrarClave();
            cifra = Cipher.getInstance("AES/GCM/NoPadding");
            cifra.init(Cipher.ENCRYPT_MODE, generar());
        } catch (Exception e) {
            call.reject("no se pudo preparar la clave: " + e.getClass().getSimpleName(), "FALLO", e);
            return;
        }
        pedirHuella(call, cifra, (c) -> {
            byte[] salida = c.doFinal(Base64.decode(datos, Base64.NO_WRAP));
            JSObject r = new JSObject();
            r.put("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP));
            r.put("datos", Base64.encodeToString(salida, Base64.NO_WRAP));
            return r;
        });
    }

    /** Abrir: huella, y el PIN descifrado. */
    @PluginMethod
    public void abrir(PluginCall call) {
        String iv = call.getString("iv");
        String datos = call.getString("datos");
        if (iv == null || datos == null) {
            call.reject("faltan el iv o los datos", "DATOS");
            return;
        }
        Cipher cifra;
        try {
            KeyStore almacen = KeyStore.getInstance(ALMACEN);
            almacen.load(null);
            if (!almacen.containsAlias(ALIAS)) {
                call.reject("no hay clave en el almacén", "SIN_CLAVE");
                return;
            }
            SecretKey clave = ((KeyStore.SecretKeyEntry) almacen.getEntry(ALIAS, null)).getSecretKey();
            cifra = Cipher.getInstance("AES/GCM/NoPadding");
            cifra.init(
                Cipher.DECRYPT_MODE,
                clave,
                new GCMParameterSpec(BITS_ETIQUETA, Base64.decode(iv, Base64.NO_WRAP))
            );
        } catch (KeyPermanentlyInvalidatedException e) {
            // Se añadió o se quitó una huella, o se quitó el bloqueo de
            // pantalla. La clave ya no vale para nada: fuera, y a usar el PIN.
            borrarClaveSinFallar();
            call.reject("cambiaron las huellas del teléfono", "INVALIDADA");
            return;
        } catch (Exception e) {
            call.reject("no se pudo preparar la clave: " + e.getClass().getSimpleName(), "FALLO", e);
            return;
        }
        pedirHuella(call, cifra, (c) -> {
            byte[] claro = c.doFinal(Base64.decode(datos, Base64.NO_WRAP));
            JSObject r = new JSObject();
            r.put("datos", Base64.encodeToString(claro, Base64.NO_WRAP));
            return r;
        });
    }

    /** Desactivar: la clave fuera. Lo que hubiera cifrado ya no se abre. */
    @PluginMethod
    public void olvidar(PluginCall call) {
        borrarClaveSinFallar();
        call.resolve();
    }

    private interface ConLaCifra {
        JSObject usar(Cipher c) throws Exception;
    }

    private void pedirHuella(PluginCall call, Cipher cifra, ConLaCifra paso) {
        FragmentActivity actividad = getActivity();
        if (actividad == null) {
            call.reject("sin pantalla", "FALLO");
            return;
        }
        if (enCurso) {
            call.reject("ya se está pidiendo la huella", "OCUPADO");
            return;
        }
        enCurso = true;

        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(call.getString("titulo", "Panal"))
            .setSubtitle(call.getString("subtitulo"))
            .setNegativeButtonText(call.getString("cancelar", "PIN"))
            .setAllowedAuthenticators(FUERTE)
            .setConfirmationRequired(false)
            .build();

        actividad.runOnUiThread(() -> {
            BiometricPrompt dialogo = new BiometricPrompt(
                actividad,
                ContextCompat.getMainExecutor(actividad),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult resultado) {
                        enCurso = false;
                        BiometricPrompt.CryptoObject cripto = resultado.getCryptoObject();
                        if (cripto == null || cripto.getCipher() == null) {
                            call.reject("el sistema no devolvió la clave", "FALLO");
                            return;
                        }
                        try {
                            call.resolve(paso.usar(cripto.getCipher()));
                        } catch (Exception e) {
                            call.reject("no se pudo usar la clave: " + e.getClass().getSimpleName(), "FALLO", e);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int codigo, @NonNull CharSequence texto) {
                        enCurso = false;
                        call.reject(texto.toString(), codigoDe(codigo));
                    }

                    // `onAuthenticationFailed` es un dedo que no se reconoce:
                    // el propio diálogo dice «inténtalo otra vez» y sigue
                    // abierto. No es el final de nada.
                }
            );
            try {
                dialogo.authenticate(info, new BiometricPrompt.CryptoObject(cifra));
            } catch (Exception e) {
                enCurso = false;
                call.reject("no se pudo abrir el diálogo: " + e.getClass().getSimpleName(), "FALLO", e);
            }
        });
    }

    /** Los fallos del diálogo, en las clases que le importan a la app. */
    private static String codigoDe(int codigo) {
        switch (codigo) {
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_CANCELED:
                return "CANCELADO";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "BLOQUEADA";
            default:
                return "FALLO";
        }
    }

    private SecretKey generar() throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            // Huella en CADA uso, no «durante un rato después de desbloquear».
            .setUserAuthenticationRequired(true)
            // Un dedo nuevo en el teléfono invalida la clave.
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Solo huella fuerte; el patrón o el PIN del teléfono no abren esto.
            // Antes de Android 11, pedirla en cada uso ya significa eso.
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        KeyGenerator generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ALMACEN);
        generador.init(spec.build());
        return generador.generateKey();
    }

    private void borrarClave() throws Exception {
        KeyStore almacen = KeyStore.getInstance(ALMACEN);
        almacen.load(null);
        if (almacen.containsAlias(ALIAS)) almacen.deleteEntry(ALIAS);
    }

    private void borrarClaveSinFallar() {
        try {
            borrarClave();
        } catch (Exception e) {
            // Si ni se puede borrar, tampoco se podrá usar.
        }
    }
}
