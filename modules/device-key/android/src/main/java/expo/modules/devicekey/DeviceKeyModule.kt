package expo.modules.devicekey

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

private const val KEYSTORE = "AndroidKeyStore"
private const val ALIAS = "location-map-device-key"

/**
 * This phone's identity: a P-256 key pair created inside Android Keystore.
 * The private key can sign but can never be read out — not by JS, not by
 * this module, not from a backup — so a signature proves the request came
 * from this physical install. The key is deleted with the app's data, which
 * makes a reinstall a new device.
 */
class DeviceKeyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeviceKey")

    /** Base64 X.509 SubjectPublicKeyInfo; creates the key on first use. */
    AsyncFunction("getPublicKey") {
      val certificate = keyStore().also { ensureKey(it) }.getCertificate(ALIAS)
        ?: throw DeviceKeyException("Device key has no certificate.")
      Base64.encodeToString(certificate.publicKey.encoded, Base64.NO_WRAP)
    }

    /** Base64 DER ECDSA-SHA256 signature over the UTF-8 bytes of `message`. */
    AsyncFunction("sign") { message: String ->
      val signature = Signature.getInstance("SHA256withECDSA").apply {
        initSign(privateKey())
        update(message.toByteArray(Charsets.UTF_8))
      }
      Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    /** Where the key lives: "strongbox", "tee", "software" or "unknown". */
    AsyncFunction("getSecurityLevel") {
      val key = privateKey()
      val info = KeyFactory.getInstance(key.algorithm, KEYSTORE).getKeySpec(key, KeyInfo::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        when (info.securityLevel) {
          KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
          KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
          KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
          else -> "unknown"
        }
      } else {
        @Suppress("DEPRECATION")
        if (info.isInsideSecureHardware) "tee" else "software"
      }
    }
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun ensureKey(store: KeyStore) {
    if (store.containsAlias(ALIAS)) return
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .build()
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE).apply {
      initialize(spec)
      generateKeyPair()
    }
  }

  private fun privateKey(): PrivateKey {
    val store = keyStore().also { ensureKey(it) }
    return store.getKey(ALIAS, null) as? PrivateKey
      ?: throw DeviceKeyException("Device key is missing or unreadable.")
  }
}

private class DeviceKeyException(message: String) : CodedException("ERR_DEVICE_KEY", message, null)
