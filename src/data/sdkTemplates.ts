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
import android.webkit.JavascriptInterface
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
import java.time.Instant
import java.util.Base64

data class LicenseVerificationResult(
    val isAuthorized: Boolean,
    val mode: String, // "trial" | "license" | "locked" | "clock_tampered" | "key_mismatch"
    val expiresAtUtc: String?,
    val requiresOnlineSync: Boolean,
    val message: String
)

/**
 * WebView JS Bridge for CPT Promo URLs (/elm-promo/{slug}/)
 * Attach via: webView.addJavascriptInterface(PromoAndroidBridge { dialog.dismiss() }, "AndroidBridge")
 */
class PromoAndroidBridge(private val onClose: () -> Unit) {
    @JavascriptInterface
    fun closePromo() {
        onClose()
    }
}

class EpicLicenseClient(
    private val context: Context,
    private val siteRootUrl: String = "https://${storeDomain}",
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

    /**
     * Automatically tries /wp-json/elm/v1/{route} first and falls back to
     * /?rest_route=/elm/v1/{route} if WordPress uses Plain Permalinks or returns HTML (!DOCTYPE).
     * Persists working route mode in EncryptedSharedPreferences.
     */
    private fun executeJsonRequest(
        route: String,
        method: String = "POST",
        bodyJson: JSONObject? = null
    ): JSONObject {
        val root = siteRootUrl.trimEnd('/')
        val preferPlain = prefs.getBoolean("use_plain_rest_route", false)
        val candidates = if (preferPlain) {
            listOf("$root/?rest_route=/elm/v1/$route", "$root/wp-json/elm/v1/$route")
        } else {
            listOf("$root/wp-json/elm/v1/$route", "$root/?rest_route=/elm/v1/$route")
        }

        var lastError = "Unable to connect to WordPress REST API"
        for ((idx, targetUrl) in candidates.withIndex()) {
            val builder = Request.Builder()
                .url(targetUrl)
                .header("Accept", "application/json")
            if (method == "POST") {
                val payload = (bodyJson ?: JSONObject()).toString()
                builder.post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
            } else {
                builder.get()
            }

            client.newCall(builder.build()).execute().use { resp ->
                val raw = (resp.body?.string() ?: "").trimStart()
                // Guard against WordPress 404/maintenance HTML instead of crashing JSONObject("<!DOCTYPE ...")
                if (raw.startsWith("<") || raw.contains("<!DOCTYPE", ignoreCase = true)) {
                    lastError = "Server returned HTML instead of JSON at $targetUrl (Plain Permalink or WAF block)."
                    if (idx == 0) continue else error(lastError)
                }
                val json = JSONObject(raw.ifEmpty { "{}" })
                val usedPlain = targetUrl.contains("rest_route=")
                prefs.edit().putBoolean("use_plain_rest_route", usedPlain).apply()
                if (!resp.isSuccessful || !json.optBoolean("ok", true)) {
                    error(json.optString("message", json.optString("error", "HTTP \${resp.code}")))
                }
                return json
            }
        }
        error(lastError)
    }

    fun activateTrialOnServer(): Result<JSONObject> = runCatching {
        val body = JSONObject().apply {
            put("app_slug", appSlug)
            put("hardware_hash", getDeviceFingerprint())
            put("device_model", "\${Build.MANUFACTURER} \${Build.MODEL}")
            put("os_version", "Android \${Build.VERSION.RELEASE}")
        }
        val json = executeJsonRequest("trial/activate", "POST", body)
        saveSignedToken(json.getString("token"), json.optString("public_key_hex", ""))
        json
    }

    fun activateLicenseKey(licenseKey: String): Result<JSONObject> = runCatching {
        val body = JSONObject().apply {
            put("app_slug", appSlug)
            put("license_key", licenseKey.trim())
            put("hardware_hash", getDeviceFingerprint())
            put("device_model", "\${Build.MANUFACTURER} \${Build.MODEL}")
            put("os_version", "Android \${Build.VERSION.RELEASE}")
        }
        val json = executeJsonRequest("license/activate", "POST", body)
        saveSignedToken(json.getString("token"), json.optString("public_key_hex", ""))
        json
    }

    fun fetchPromoOffer(): JSONObject? = runCatching {
        executeJsonRequest("promo?app_slug=$appSlug", "GET", null)
    }.getOrNull()

    /**
     * Offline-first verification with Ed25519 signature, explicit key-mismatch warning, & clock rollback protection.
     */
    fun verifyLocallyOffline(): LicenseVerificationResult {
        val token = prefs.getString("signed_token", null)
            ?: return LicenseVerificationResult(false, "locked", null, true, "No active license or trial")

        val parts = token.split(".")
        if (parts.size != 2) return LicenseVerificationResult(false, "locked", null, true, "Corrupt token")

        val payloadBytes = Base64.getUrlDecoder().decode(parts[0])
        val sigBytes = Base64.getUrlDecoder().decode(parts[1])

        // Verify Ed25519 signature against embedded 64-char HEX public key
        val cleanHex = publicKeyHex.trim()
        require(cleanHex.length == 64) { "Invalid Ed25519 publicKeyHex length (expected 64 hex chars)" }
        val spec = EdDSANamedCurveTable.getByName("Ed25519")
        val pubKey = EdDSAPublicKey(EdDSAPublicKeySpec(hexToBytes(cleanHex), spec))
        val verifier = EdDSAEngine(MessageDigest.getInstance(spec.hashAlgorithm))
        verifier.initVerify(pubKey)
        verifier.update(parts[0].toByteArray(Charsets.UTF_8))

        if (!verifier.verify(sigBytes)) {
            val serverHex = prefs.getString("last_server_pub_hex", "") ?: ""
            val msg = if (serverHex.isNotEmpty() && !serverHex.equals(cleanHex, ignoreCase = true)) {
                "عدم تطابق کلید عمومی Ed25519: کلید سرور با publicKeyHex داخل EpicLicenseClient همخوانی ندارد."
            } else {
                "Invalid cryptographic Ed25519 signature"
            }
            return LicenseVerificationResult(false, "key_mismatch", null, true, msg)
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

    private fun saveSignedToken(token: String, serverPubHex: String) {
        prefs.edit()
            .putString("signed_token", token)
            .putString("last_server_pub_hex", serverPubHex)
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

const SITE_ROOT = 'https://${storeDomain}';

async function fetchElmJson(route: string, options?: RequestInit) {
  const urls = [\`\${SITE_ROOT}/wp-json/elm/v1/\${route}\`, \`\${SITE_ROOT}/?rest_route=/elm/v1/\${route}\`];
  for (const url of urls) {
    const res = await fetch(url, {
      ...options,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options?.headers || {}) },
    });
    const text = await res.text();
    if (!text.trimStart().startsWith('<')) {
      return JSON.parse(text);
    }
  }
  throw new Error('WordPress REST endpoint returned HTML instead of JSON.');
}

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
  return fetchElmJson('license/activate', {
    method: 'POST',
    body: JSON.stringify({ app_slug: '${appSlug}', license_key: licenseKey, hardware_hash }),
  });
}

export async function fetchPromoOffer() {
  return fetchElmJson(\`promo?app_slug=${appSlug}\`, { method: 'GET' });
}`;
}

export function getAiStudioMasterPrompt(storeDomain: string): string {
  return `شما یک معمار ارشد نرم‌افزار (Android Kotlin/Gradle و Web React/Node.js) هستید و باید اپلیکیشن این پروژه را به‌صورت کامل به پلاگین وردپرس/ووکامرس «Epic License Manager» در دامنه https://${storeDomain} متصل کنید.

قوانین اجباری پیش از نوشتن کد:
۱) ابتدا ۵ سوال تخصصی و دقیق زیر را (متناسب با ساختار همین پروژه) از توسعه‌دهنده بپرس و تا دریافت پاسخ کدی تولید نکن:
   - سوال ۱: روش درآمدزایی این پروژه کدام است؟ (روش اول: قفل بودن بخش‌های پولی از ابتدا | روش دوم: دوره Trial رایگان کامل با کنترل سرور و سپس قفل شدن امکانات)
   - سوال ۲: دقیقاً کدام صفحات، دکمه‌ها یا ماژول‌های این پروژه باید در حالت بدون لایسنس محدود شوند؟ (نام دقیق کامپوننت‌ها/اکتیویتی‌ها مشخص شود)
   - سوال ۳: مدت دوره Trial چند روز است و پنجره مجاز کارکرد آفلاین (Offline Grace Days) بین هر همگام‌سازی چقدر باشد؟
   - سوال ۴: کادر تبلیغاتی HTML دریافتی از سرور (یا آدرس سبک \`promo_url\` در WebView) در چه زمانی نمایش داده شود؟ (بازه زمانی دوره‌ای مثل هر ۱۸۰ ثانیه، هنگام کلیک روی بخش قفل‌شده، یا هر دو)
   - سوال ۵: آدرس دقیق محصول متغیر در ووکامرس (https://${storeDomain}/product/...)، شناسه یکتای اپلیکیشن (\`app_slug\`) و کلید عمومی ۶۴ کاراکتری \`public_key_hex\` دریافتی از پیشخوان افزونه چیست؟

۲) پس از دریافت پاسخ، پیاده‌سازی زیر را با استاندارد کامل تولید کن:
   - استفاده از مسیرهای REST استاندارد با قابلیت Failover خودکار روی پیوند یکتای ساده (\`/?rest_route=/elm/v1/...\`) و گارد تشخیص خروجی HTML:
     • GET  https://${storeDomain}/wp-json/elm/v1/app/handshake?app_slug={slug}
     • POST https://${storeDomain}/wp-json/elm/v1/trial/activate
     • POST https://${storeDomain}/wp-json/elm/v1/license/activate
     • POST https://${storeDomain}/wp-json/elm/v1/license/verify
     • GET  https://${storeDomain}/wp-json/elm/v1/promo?app_slug={slug}
   - در اندروید (قابل کامپایل مستقیم در Android Studio): ساخت اثرانگشت سخت‌افزاری استاندارد (SHA-256 از ANDROID_ID + Build Specs)، ذخیره توکن امضاشده در EncryptedSharedPreferences، اعتبارسنجی امضای Ed25519 با بررسی عدم تطابق کلید عمومی Hex، تشخیص دستکاری ساعت (Clock Rollback)، و نمایش تبلیغات HTML سرور (یا بارگذاری \`promo_url\` در WebView مجهز به \`AndroidBridge.closePromo()\`).
   - در پایان خروجی، فایل استاندارد \`elm-manifest.json\` را تولید کن تا توسعه‌دهنده با یک کلیک آن را در پلاگین Epic License Manager ایمپورت کرده و پکیج لایسنس و متغیرهای ووکامرس را متصل کند.`;
}
