export function getAndroidGradleSnippet(): string {
  return `// app/build.gradle.kts
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // Pure JVM / Android Ed25519 verification (Zero native C++ crashes)
    implementation("net.i2p.crypto:eddsa:0.3.0")
}`;
}

export function getAndroidKotlinClient(storeDomain: string, appSlug: string, publicKeyHex: string): string {
  return `package com.epiclicense.sdk

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import net.i2p.crypto.eddsa.EdDSAEngine
import net.i2p.crypto.eddsa.EdDSAPublicKey
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import net.i2p.crypto.eddsa.spec.EdDSAPublicKeySpec
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.security.Signature
import java.time.Instant
import java.util.Base64

data class LicenseVerificationResult(
    val isAuthorized: Boolean,
    val mode: String, // "trial" | "license" | "locked" | "clock_tampered"
    val expiresAtUtc: String?,
    val requiresOnlineSync: Boolean,
    val message: String
)

class EpicLicenseClient(
    private val context: Context,
    private val baseUrl: String = "https://${storeDomain}/wp-json/elm/v1",
    private val appSlug: String = "${appSlug}",
    private val publicKeyHex: String = "${publicKeyHex}"
) {
    private val client = OkHttpClient()
    private val prefs by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "elm_secure_vault",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    @SuppressLint("HardwareIds")
    fun getDeviceFingerprint(): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"
        val raw = "$androidId|\${Build.BRAND}|\${Build.MODEL}|\${Build.BOARD}|\${Build.HARDWARE}"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun activateTrialOnServer(): Result<JSONObject> = runCatching {
        val body = JSONObject().apply {
            put("app_slug", appSlug)
            put("hardware_hash", getDeviceFingerprint())
            put("device_model", "\${Build.MANUFACTURER} \${Build.MODEL}")
            put("os_version", "Android \${Build.VERSION.RELEASE}")
        }
        val req = Request.Builder()
            .url("$baseUrl/trial/activate")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { resp ->
            val json = JSONObject(resp.body?.string() ?: "{}")
            if (!resp.isSuccessful || !json.optBoolean("ok")) {
                error(json.optString("message", json.optString("error", "Trial failed")))
            }
            saveSignedToken(json.getString("token"))
            json
        }
    }

    fun activateLicenseKey(licenseKey: String): Result<JSONObject> = runCatching {
        val body = JSONObject().apply {
            put("app_slug", appSlug)
            put("license_key", licenseKey.trim())
            put("hardware_hash", getDeviceFingerprint())
            put("device_model", "\${Build.MANUFACTURER} \${Build.MODEL}")
        }
        val req = Request.Builder()
            .url("$baseUrl/license/activate")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(req).execute().use { resp ->
            val json = JSONObject(resp.body?.string() ?: "{}")
            if (!resp.isSuccessful || !json.optBoolean("ok")) {
                error(json.optString("error", "Activation failed"))
            }
            saveSignedToken(json.getString("token"))
            json
        }
    }

    fun fetchPromoOfferHtml(): JSONObject? = runCatching {
        val req = Request.Builder().url("$baseUrl/promo?app_slug=$appSlug").get().build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) null else JSONObject(resp.body?.string() ?: "{}")
        }
    }.getOrNull()

    /**
     * Offline-first verification with Ed25519 signature + clock rollback protection.
     */
    fun verifyLocallyOffline(): LicenseVerificationResult {
        val token = prefs.getString("signed_token", null)
            ?: return LicenseVerificationResult(false, "locked", null, true, "No active license or trial")

        val parts = token.split(".")
        if (parts.size != 2) return LicenseVerificationResult(false, "locked", null, true, "Corrupt token")

        val payloadBytes = Base64.getUrlDecoder().decode(parts[0])
        val sigBytes = Base64.getUrlDecoder().decode(parts[1])

        // Verify Ed25519 signature against embedded server public key
        val spec = EdDSANamedCurveTable.getByName("Ed25519")
        val pubKey = EdDSAPublicKey(EdDSAPublicKeySpec(hexToBytes(publicKeyHex), spec))
        val verifier = EdDSAEngine(MessageDigest.getInstance(spec.hashAlgorithm))
        verifier.initVerify(pubKey)
        verifier.update(parts[0].toByteArray(Charsets.UTF_8))
        if (!verifier.verify(sigBytes)) {
            return LicenseVerificationResult(false, "locked", null, true, "Invalid cryptographic signature")
        }

        val payload = JSONObject(String(payloadBytes, Charsets.UTF_8))
        if (payload.optString("hardware_hash") != getDeviceFingerprint()) {
            return LicenseVerificationResult(false, "locked", null, true, "Hardware mismatch")
        }

        val nowEpoch = Instant.now().epochSecond
        val lastSeenEpoch = prefs.getLong("last_monotonic_epoch", 0L)
        if (nowEpoch + 300 < lastSeenEpoch) {
            return LicenseVerificationResult(false, "clock_tampered", null, true, "Device clock rollback detected; online sync required")
        }
        prefs.edit().putLong("last_monotonic_epoch", nowEpoch).apply()

        val expStr = payload.optString("expires_at_utc", "")
        if (expStr.isNotEmpty() && expStr != "null") {
            val expEpoch = Instant.parse(expStr).epochSecond
            if (nowEpoch >= expEpoch) {
                return LicenseVerificationResult(false, "locked", expStr, true, "Subscription or trial expired")
            }
        }

        val issuedEpoch = Instant.parse(payload.getString("server_time_utc")).epochSecond
        val graceDays = payload.optLong("offline_grace_days", 14L)
        val needsSync = (nowEpoch - issuedEpoch) > (graceDays * 86400L)
        if (needsSync) {
            return LicenseVerificationResult(false, "locked", expStr, true, "Offline grace window elapsed; connect briefly to sync")
        }

        return LicenseVerificationResult(true, payload.optString("type", "license"), expStr, false, "Verified offline")
    }

    private fun saveSignedToken(token: String) {
        prefs.edit()
            .putString("signed_token", token)
            .putLong("last_monotonic_epoch", Instant.now().epochSecond)
            .apply()
    }

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}`;
}

export function getWebSdkSnippet(storeDomain: string, appSlug: string): string {
  return `// Web / React / Node.js License Client (TypeScript)
export interface ElmTokenPayload {
  type: 'trial' | 'license';
  app_slug: string;
  hardware_hash: string;
  expires_at_utc: string | null;
  server_time_utc: string;
  offline_grace_days: number;
}

const API_BASE = 'https://${storeDomain}/wp-json/elm/v1';

export async function getBrowserFingerprint(): Promise<string> {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function activateLicense(licenseKey: string) {
  const hardware_hash = await getBrowserFingerprint();
  const res = await fetch(\`\${API_BASE}/license/activate\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_slug: '${appSlug}', license_key: licenseKey, hardware_hash }),
  });
  return res.json();
}

export async function fetchPromoOffer() {
  const res = await fetch(\`\${API_BASE}/promo?app_slug=${appSlug}\`);
  return res.json();
}`;
}

export function getAiStudioMasterPrompt(storeDomain: string): string {
  return `شما یک معمار ارشد نرم‌افزار (Android Kotlin/Gradle و Web React/Node.js) هستید و باید اپلیکیشن این پروژه را به‌صورت کامل به پلاگین وردپرس/ووکامرس «Epic License Manager» در دامنه https://${storeDomain} متصل کنید.

قوانین اجباری پیش از نوشتن کد:
۱) ابتدا ۵ سوال تخصصی و دقیق زیر را (متناسب با ساختار همین پروژه) از توسعه‌دهنده بپرس و تا دریافت پاسخ کدی تولید نکن:
   - سوال ۱: روش درآمدزایی این پروژه کدام است؟ (روش اول: قفل بودن بخش‌های پولی از ابتدا | روش دوم: دوره Trial رایگان کامل با کنترل سرور و سپس قفل شدن امکانات)
   - سوال ۲: دقیقاً کدام صفحات، دکمه‌ها یا ماژول‌های این پروژه باید در حالت بدون لایسنس محدود شوند؟ (نام دقیق کامپوننت‌ها/اکتیویتی‌ها مشخص شود)
   - سوال ۳: مدت دوره Trial چند روز است و پنجره مجاز کارکرد آفلاین (Offline Grace Days) بین هر همگام‌سازی چقدر باشد؟
   - سوال ۴: کادر تبلیغاتی HTML دریافتی از سرور در چه زمانی نمایش داده شود؟ (بازه زمانی دوره‌ای مثل هر ۱۸۰ ثانیه، هنگام کلیک روی بخش قفل‌شده، یا هر دو)
   - سوال ۵: آدرس دقیق محصول متغیر در ووکامرس (https://${storeDomain}/product/...) و شناسه یکتای اپلیکیشن (app_slug) چیست؟

۲) پس از دریافت پاسخ، پیاده‌سازی زیر را با استاندارد کامل تولید کن:
   - استفاده از مسیرهای REST استاندارد:
     • POST https://${storeDomain}/wp-json/elm/v1/trial/activate
     • POST https://${storeDomain}/wp-json/elm/v1/license/activate
     • POST https://${storeDomain}/wp-json/elm/v1/license/verify
     • GET  https://${storeDomain}/wp-json/elm/v1/promo?app_slug={slug}
   - در اندروید (قابل کامپایل مستقیم در Android Studio): ساخت اثرانگشت سخت‌افزاری استاندارد (SHA-256 از ANDROID_ID + Build Specs)، ذخیره توکن امضاشده در EncryptedSharedPreferences، اعتبارسنجی امضای Ed25519 در حالت آفلاین، تشخیص دستکاری ساعت (Clock Rollback)، و نمایش تبلیغات HTML سرور در کادر Floating Dialog / WebView به همراه دکمه انتقال به صفحه خرید ووکامرس.
   - در پایان خروجی، فایل استاندارد \`elm-manifest.json\` را تولید کن تا توسعه‌دهنده با یک کلیک آن را در پلاگین Epic License Manager ایمپورت کرده و پکیج لایسنس و متغیرهای ووکامرس را متصل کند.`;
}
