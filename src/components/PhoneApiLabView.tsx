import React, { useState } from 'react';
import {
  Clock,
  Lock,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { LicenseMode, SimulatorState } from '../shared/types.js';

interface Props {
  state: SimulatorState;
  lang: 'fa' | 'en';
  onRefreshState: () => Promise<void>;
}

export const PhoneApiLabView: React.FC<Props> = ({ state, onRefreshState }) => {
  const [selectedAppSlug, setSelectedAppSlug] = useState(state.apps[0]?.slug ?? 'yektap-crm-mobile');
  const activeApp = state.apps.find((a) => a.slug === selectedAppSlug) ?? state.apps[0];

  const [modeOverride, setModeOverride] = useState<LicenseMode>(activeApp?.mode ?? 'method2_trial');
  const [hardwareHash] = useState('android-8f3c91a4d2e07b99');
  const [isOffline, setIsOffline] = useState(false);
  const [clockTampered, setClockTampered] = useState(false);
  const [localToken, setLocalToken] = useState<string | null>(null);
  const [decodedPayload, setDecodedPayload] = useState<Record<string, unknown> | null>(null);
  const [signatureValid, setSignatureValid] = useState<boolean | null>(null);
  const [phoneStatusMsg, setPhoneStatusMsg] = useState<string>(
    'آماده تست: روی دکمه‌های شبیه‌ساز گوشی کلیک کنید.'
  );
  const [licenseInput, setLicenseInput] = useState(state.licenses[0]?.licenseKey ?? 'ELM-9F4A-22C1-88B0-3E19');
  const [showFloatingPromo, setShowFloatingPromo] = useState(false);
  const [promoData, setPromoData] = useState<{ html: string; ctaLabel: string; purchaseUrl: string } | null>(null);

  const inspectToken = async (token: string) => {
    const res = await fetch('/api/sim/v1/token/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_slug: activeApp.slug, token }),
    });
    const data = (await res.json()) as { valid: boolean; payload: Record<string, unknown> | null };
    setSignatureValid(data.valid);
    setDecodedPayload(data.payload);
  };

  const handleActivateTrial = async () => {
    if (isOffline) {
      setPhoneStatusMsg('خطای شبکه: برای شروع اولیه Trial اتصال کوتاه اینترنت مورد نیاز است.');
      return;
    }
    const res = await fetch('/api/sim/v1/trial/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_slug: activeApp.slug,
        hardware_hash: hardwareHash,
        device_model: 'Pixel 9 Pro',
        os_version: 'Android 15',
      }),
    });
    const data = (await res.json()) as { ok: boolean; token?: string; message?: string; error?: string };
    await onRefreshState();
    if (data.ok && data.token) {
      setLocalToken(data.token);
      setClockTampered(false);
      await inspectToken(data.token);
      setPhoneStatusMsg(data.message || 'دوره Trial فعال شد و توکن امضاشده در حافظه رمزنگاری‌شده ذخیره گردید.');
    } else {
      setPhoneStatusMsg(data.message || data.error || 'دوره آزمایشی مسدود یا منقضی شده است.');
      await handleFetchPromo(true);
    }
  };

  const handleExpireTrial = async () => {
    await fetch('/api/sim/v1/trial/expire-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_slug: activeApp.slug, hardware_hash: hardwareHash }),
    });
    setLocalToken(null);
    setDecodedPayload(null);
    setSignatureValid(null);
    await onRefreshState();
    setPhoneStatusMsg('دوره Trial روی سرور منقضی شد. اکنون امکانات پولی قفل و بنر تبلیغاتی فعال است.');
    await handleFetchPromo(true);
  };

  const handleClearDataReinstall = async () => {
    setLocalToken(null);
    setDecodedPayload(null);
    setSignatureValid(null);
    setClockTampered(false);
    setPhoneStatusMsg('حافظه گوشی پاک شد (شبیه‌سازی حذف و نصب مجدد). حالا دکمه Trial را بزنید تا کنترل سرور را ببینید.');
  };

  const handleActivateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) {
      setPhoneStatusMsg('در حالت کاملاً آفلاین، فعال‌سازی کلید جدید ممکن نیست؛ فقط توکن ذخیره‌شده قبلی بررسی می‌شود.');
      return;
    }
    const res = await fetch('/api/sim/v1/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_slug: activeApp.slug,
        license_key: licenseInput,
        hardware_hash: hardwareHash,
        device_model: 'Pixel 9 Pro',
      }),
    });
    const data = (await res.json()) as { ok: boolean; token?: string; error?: string };
    await onRefreshState();
    if (data.ok && data.token) {
      setLocalToken(data.token);
      setClockTampered(false);
      setShowFloatingPromo(false);
      await inspectToken(data.token);
      setPhoneStatusMsg('کلید لایسنس تایید و با امضای Ed25519 روی گوشی ذخیره شد.');
    } else {
      setPhoneStatusMsg(`خطا در فعال‌سازی: ${data.error || 'کلید نامعتبر است'}`);
    }
  };

  const handleOfflineVerify = async () => {
    if (!localToken) {
      setPhoneStatusMsg('هیچ توکنی در حافظه گوشی وجود ندارد. بخش‌های پولی قفل هستند.');
      return;
    }
    if (clockTampered) {
      setPhoneStatusMsg('هشدار امنیتی: دستکاری ساعت گوشی (Clock Rollback) شناسایی شد! اپلیکیشن تا زمان همگام‌سازی آنلاین قفل شد.');
      return;
    }
    await inspectToken(localToken);
    setPhoneStatusMsg(
      isOffline
        ? 'تایید آفلاین موفق: امضای دیجیتال Ed25519 بدون نیاز به اینترنت معتبر است (در محدوده پنجره همگام‌سازی).'
        : 'تایید آنلاین و همگام‌سازی دوره‌ای با سرور انجام شد.'
    );
  };

  const handleFetchPromo = async (openModal = true) => {
    const res = await fetch(`/api/sim/v1/promo?app_slug=${encodeURIComponent(activeApp.slug)}`);
    const data = (await res.json()) as {
      ok: boolean;
      html: string;
      cta_label: string;
      purchase_url: string;
    };
    await onRefreshState();
    if (data.ok) {
      setPromoData({
        html: data.html,
        ctaLabel: data.cta_label,
        purchaseUrl: data.purchase_url,
      });
      if (openModal) setShowFloatingPromo(true);
    }
  };

  const isUnlocked = Boolean(localToken) && !clockTampered && signatureValid !== false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Interactive Android Device Simulator */}
      <div className="lg:col-span-5 flex flex-col items-center space-y-4">
        {/* Controls above phone */}
        <div className="w-full bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <select
              value={selectedAppSlug}
              onChange={(e) => {
                const slug = e.target.value;
                setSelectedAppSlug(slug);
                const found = state.apps.find((a) => a.slug === slug);
                if (found) setModeOverride(found.mode);
              }}
              className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            >
              {state.apps.map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setModeOverride('method1_gated')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${
                  modeOverride === 'method1_gated' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                روش ۱
              </button>
              <button
                type="button"
                onClick={() => setModeOverride('method2_trial')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${
                  modeOverride === 'method2_trial' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                روش ۲ (Trial)
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsOffline((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${
                isOffline
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              {isOffline ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
              <span>{isOffline ? 'اینترنت قطع (Offline)' : 'اینترنت متصل'}</span>
            </button>

            <button
              type="button"
              onClick={() => setClockTampered((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${
                clockTampered
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{clockTampered ? 'ساعت دستکاری شده' : 'تست دستکاری ساعت'}</span>
            </button>

            <button
              type="button"
              onClick={handleOfflineVerify}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>بررسی محلی توکن</span>
            </button>
          </div>
        </div>

        {/* Simulated Phone Bezel */}
        <div className="w-full max-w-[360px] bg-slate-900 rounded-[28px] p-3 border border-slate-800 shadow-sm relative">
          <div className="bg-white rounded-[20px] overflow-hidden min-h-[540px] flex flex-col relative">
            {/* Phone Status Bar */}
            <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-sky-300" />
                <span className="font-medium truncate max-w-[160px]">{activeApp.name}</span>
              </div>
              <span className={isUnlocked ? 'text-emerald-400' : 'text-amber-300'}>
                {clockTampered ? 'تقلب ساعت' : isUnlocked ? 'فعال' : 'محدود'}
              </span>
            </div>

            {/* Phone Body */}
            <div className="p-4 flex-1 space-y-3 overflow-y-auto">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                {phoneStatusMsg}
              </div>

              {/* Method 2 Trial Controls */}
              {modeOverride === 'method2_trial' && (
                <div className="p-3 border border-slate-200 rounded-xl space-y-2">
                  <div className="text-xs font-semibold text-slate-900">
                    کنترل دوره Trial ({activeApp.trialDays} روزه)
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    <button
                      type="button"
                      onClick={handleActivateTrial}
                      className="w-full py-2 px-3 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
                    >
                      فعالسازی / بررسی دوره رایگان (Trial)
                    </button>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={handleClearDataReinstall}
                        className="py-1.5 px-2 text-[11px] font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>حذف و نصب مجدد</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExpireTrial}
                        className="py-1.5 px-2 text-[11px] font-medium border border-amber-300 bg-amber-50 rounded-lg text-amber-900 hover:bg-amber-100"
                      >
                        شبیه‌سازی پایان Trial
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Gated App Features List */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-700">امکانات کلیدی اپلیکیشن:</div>
                {activeApp.gatedFeatures.map((feat) => (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => {
                      if (!isUnlocked) {
                        setPhoneStatusMsg(`بخش «${feat}» قفل است. بنر تبلیغاتی خرید لایسنس نمایش داده شد.`);
                        void handleFetchPromo(true);
                      } else {
                        setPhoneStatusMsg(`بخش «${feat}» با موفقیت باز شد.`);
                      }
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg border text-xs flex items-center justify-between transition-colors ${
                      isUnlocked
                        ? 'bg-emerald-50/60 border-emerald-200 text-slate-900 hover:bg-emerald-50'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span>{feat}</span>
                    {isUnlocked ? (
                      <Unlock className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-700" />
                    )}
                  </button>
                ))}
              </div>

              {/* License Key Input */}
              <form onSubmit={handleActivateLicense} className="pt-2 border-t border-slate-100 space-y-2">
                <label className="block text-[11px] font-medium text-slate-600">
                  ورود کلید لایسنس خریداری‌شده از {state.woocommerce.storeDomain}:
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    dir="ltr"
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap"
                  >
                    فعال‌سازی
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleFetchPromo(true)}
                  className="w-full py-1.5 text-xs font-medium text-sky-900 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100"
                >
                  دریافت کادر تبلیغاتی HTML از سرور
                </button>
              </form>
            </div>

            {/* Sandboxed Floating HTML Promo Modal inside Phone */}
            {showFloatingPromo && promoData && (
              <div className="absolute inset-0 bg-slate-950/60 p-4 flex items-center justify-center z-20">
                <div className="bg-white rounded-xl w-full p-3.5 shadow-lg space-y-3 border border-slate-200">
                  <iframe
                    title="Promo Preview"
                    sandbox=""
                    srcDoc={`<!doctype html><html dir="rtl" lang="fa"><body style="margin:0;padding:4px;">${promoData.html}</body></html>`}
                    className="w-full h-44 border-0 rounded"
                  />
                  <div className="flex flex-col gap-2">
                    <a
                      href={promoData.purchaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-2 px-3 text-xs font-medium text-center bg-sky-800 text-white rounded-lg hover:bg-sky-900"
                    >
                      {promoData.ctaLabel}
                    </a>
                    <button
                      type="button"
                      onClick={() => setShowFloatingPromo(false)}
                      className="w-full py-1.5 text-xs text-slate-600 hover:text-slate-900"
                    >
                      بستن کادر تبلیغاتی
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Ed25519 Signed Token Inspector + Live REST API Logs */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-800" />
              <h2 className="text-base font-semibold text-slate-900">
                بازرس توکن امضاشده آفلاین (Ed25519 Offline Token)
              </h2>
            </div>
            {signatureValid !== null && (
              <span
                className={`text-xs font-medium ${
                  signatureValid ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {signatureValid ? 'امضای دیجیتال معتبر (Verified)' : 'امضا نامعتبر'}
              </span>
            )}
          </div>

          {localToken ? (
            <div className="space-y-3">
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">توکن فشرده ذخیره‌شده روی دستگاه:</div>
                <div
                  dir="ltr"
                  className="p-2.5 bg-slate-950 text-sky-300 rounded-lg font-mono text-[11px] break-all max-h-24 overflow-y-auto"
                >
                  {localToken}
                </div>
              </div>
              {decodedPayload && (
                <div>
                  <div className="text-[11px] font-medium text-slate-500 mb-1">محتوای رمزگشایی‌شده (Payload):</div>
                  <pre
                    dir="ltr"
                    className="p-3 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-800 overflow-x-auto"
                  >
                    {JSON.stringify(decodedPayload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
              هنوز توکنی در حافظه گوشی ثبت نشده است. برای مشاهده ساختار توکن امضاشده، دوره Trial یا یک کلید لایسنس را فعال کنید.
            </div>
          )}
        </div>

        {/* Live API Exchange Console */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            گزارش زنده درخواست‌های REST API (/wp-json/elm/v1/*)
          </h3>
          {state.apiLogs.length === 0 ? (
            <div className="p-5 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
              تراکنش API ثبت نشده است. با دکمه‌های شبیه‌ساز گوشی یک درخواست ارسال کنید.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto">
              {state.apiLogs.map((log) => (
                <div key={log.id} className="border border-slate-200 rounded-lg overflow-hidden" dir="ltr">
                  <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-mono">
                    <span className="font-semibold text-slate-800">
                      {log.method} {log.endpoint}
                    </span>
                    <span className={log.status < 300 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                      HTTP {log.status}
                    </span>
                  </div>
                  <pre className="p-2.5 bg-slate-950 text-slate-100 text-[11px] font-mono overflow-x-auto">
                    {JSON.stringify(log.responseBody, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
