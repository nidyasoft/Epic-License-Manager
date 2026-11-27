import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Edit3,
  FileCode2,
  FolderOpen,
  KeyRound,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { formatCalendarDate } from '../shared/calendar.js';
import { fetchJson } from '../shared/http.js';
import type { ElmApp, OrderStatus, PluginVirtualFile, SimulatorState } from '../shared/types.js';

interface Props {
  state: SimulatorState;
  files: PluginVirtualFile[];
  lang: 'fa' | 'en';
  onSaveWooSettings: (patch: { storeDomain: string; triggerStatuses: OrderStatus[] }) => Promise<void>;
  onCreateApp: (app: {
    slug: string;
    name: string;
    platform: 'android' | 'web' | 'cross_platform';
    mode: 'method1_gated' | 'method2_trial';
    trialDays: number;
    offlineGraceDays: number;
    purchaseUrl: string;
    gatedFeatures: string[];
  }) => Promise<void>;
  onUpdateApp: (
    appId: string,
    patch: {
      name?: string;
      platform?: 'android' | 'web' | 'cross_platform';
      mode?: 'method1_gated' | 'method2_trial';
      trialDays?: number;
      offlineGraceDays?: number;
      purchaseUrl?: string;
      gatedFeatures?: string[];
      isActive?: boolean;
      regenerateKeys?: boolean;
      customSeedHex?: string;
      publicKeyHexOverride?: string;
    }
  ) => Promise<void>;
  onToggleApp: (appId: string) => Promise<void>;
  onDownloadZip: () => void;
}

export const PluginBuilderView: React.FC<Props> = ({
  state,
  files,
  lang,
  onSaveWooSettings,
  onCreateApp,
  onUpdateApp,
  onToggleApp,
  onDownloadZip,
}) => {
  const [selectedFile, setSelectedFile] = useState<string>(files[0]?.path ?? '');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [storeDomain, setStoreDomain] = useState(state.woocommerce.storeDomain);
  const [triggerStatuses, setTriggerStatuses] = useState<OrderStatus[]>(state.woocommerce.triggerStatuses);
  const [savingSettings, setSavingSettings] = useState(false);

  // Add / Edit App state
  const [showNewApp, setShowNewApp] = useState(false);
  const [editingApp, setEditingApp] = useState<ElmApp | null>(null);
  const [manifestJson, setManifestJson] = useState('');
  const [appName, setAppName] = useState('');
  const [appSlug, setAppSlug] = useState('');
  const [appPlatform, setAppPlatform] = useState<'android' | 'web' | 'cross_platform'>('android');
  const [appMode, setAppMode] = useState<'method1_gated' | 'method2_trial'>('method2_trial');
  const [trialDays, setTrialDays] = useState(14);
  const [graceDays, setGraceDays] = useState(14);
  const [purchaseUrl, setPurchaseUrl] = useState('');
  const [gatedText, setGatedText] = useState('خروجی اکسل پیشرفته، گزارش مالیاتی، اتصال ابری');
  const [editSeedHex, setEditSeedHex] = useState('');
  const [editPubHex, setEditPubHex] = useState('');

  // Key & Live Signature Test Modal state
  const [keyModalApp, setKeyModalApp] = useState<ElmApp | null>(null);
  const [sigTestResult, setSigTestResult] = useState<{
    token: string;
    verifiedWithAppHex: boolean;
    diagnosticMessage: string;
  } | null>(null);

  const activeFile = files.find((f) => f.path === selectedFile) ?? files[0];

  const toggleStatus = (status: OrderStatus) => {
    setTriggerStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await onSaveWooSettings({
        storeDomain: storeDomain.trim() || 'yektap.ir',
        triggerStatuses: triggerStatuses.length ? triggerStatuses : ['completed'],
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleImportManifest = () => {
    try {
      const parsed = JSON.parse(manifestJson) as Record<string, unknown>;
      if (typeof parsed.app_name === 'string') setAppName(parsed.app_name);
      if (typeof parsed.app_slug === 'string') setAppSlug(parsed.app_slug);
      if (parsed.platform === 'web' || parsed.platform === 'android' || parsed.platform === 'cross_platform') {
        setAppPlatform(parsed.platform);
      }
      if (parsed.license_mode === 'method1_gated' || parsed.license_mode === 'method2_trial') {
        setAppMode(parsed.license_mode);
      }
      if (typeof parsed.trial_days === 'number') setTrialDays(parsed.trial_days);
      if (typeof parsed.offline_grace_days === 'number') setGraceDays(parsed.offline_grace_days);
      if (typeof parsed.purchase_url === 'string') setPurchaseUrl(parsed.purchase_url);
      if (Array.isArray(parsed.gated_features)) {
        setGatedText(parsed.gated_features.map(String).join('، '));
      }
    } catch {
      // Ignore malformed JSON silently
    }
  };

  const startEditApp = (app: ElmApp) => {
    setEditingApp(app);
    setShowNewApp(true);
    setAppName(app.name);
    setAppSlug(app.slug);
    setAppPlatform(app.platform);
    setAppMode(app.mode);
    setTrialDays(app.trialDays);
    setGraceDays(app.offlineGraceDays);
    setPurchaseUrl(app.purchaseUrl);
    setGatedText(app.gatedFeatures.join('، '));
    setEditSeedHex('');
    setEditPubHex(app.publicKeyHex);
  };

  const resetAppForm = () => {
    setEditingApp(null);
    setAppName('');
    setAppSlug('');
    setPurchaseUrl('');
    setEditSeedHex('');
    setEditPubHex('');
    setManifestJson('');
    setShowNewApp(false);
  };

  const handleAppFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appName.trim() || !appSlug.trim()) return;
    const features = gatedText.split(/[،,]/).map((s) => s.trim()).filter(Boolean);

    if (editingApp) {
      await onUpdateApp(editingApp.id, {
        name: appName,
        platform: appPlatform,
        mode: appMode,
        trialDays,
        offlineGraceDays: graceDays,
        purchaseUrl: purchaseUrl.trim() || `https://${storeDomain}/product/${appSlug.trim().toLowerCase()}`,
        gatedFeatures: features,
        customSeedHex: editSeedHex.trim() || undefined,
        publicKeyHexOverride: editPubHex.trim() !== editingApp.publicKeyHex ? editPubHex.trim() : undefined,
      });
    } else {
      await onCreateApp({
        slug: appSlug,
        name: appName,
        platform: appPlatform,
        mode: appMode,
        trialDays,
        offlineGraceDays: graceDays,
        purchaseUrl: purchaseUrl.trim() || `https://${storeDomain}/product/${appSlug.trim().toLowerCase()}`,
        gatedFeatures: features,
      });
    }
    resetAppForm();
  };

  const runLiveSignatureTest = async (app: ElmApp) => {
    const res = await fetchJson<{
      token: string;
      verifiedWithAppHex: boolean;
      diagnosticMessage: string;
    }>(`/api/sim/apps/${app.id}/test-signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Admin Key Sync Diagnostic' }),
    });
    setSigTestResult(res);
  };

  const copyCode = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedPath(key);
    setTimeout(() => setCopiedPath(null), 1600);
  };

  const activeCount = state.licenses.filter((l) => l.status === 'active').length;
  const trialBlocked = state.trials.reduce((acc, t) => acc + t.blockedReinstallAttempts, 0);

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">
            {lang === 'fa' ? 'لایسنس‌های صادرشده / فعال' : 'Total / Active Licenses'}
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {state.licenses.length} <span className="text-sm font-medium text-emerald-700">/ {activeCount} فعال</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            WooCommerce HPOS + PHP 8.2+ Sodium
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">
            {lang === 'fa' ? 'اپلیکیشن‌های متصل' : 'Registered Apps'}
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{state.apps.length}</div>
          <div className="mt-1 text-xs text-slate-500">
            Ed25519 Hex & Base64 Key Sync
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">
            {lang === 'fa' ? 'نصب مجدد مسدودشده Trial' : 'Blocked Trial Reinstalls'}
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-700 tabular-nums">{trialBlocked}</div>
          <div className="mt-1 text-xs text-slate-500">
            پچ خودکار mu-plugins فعال
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">
            {lang === 'fa' ? 'تقویم فعال رابط افزونه' : 'Active Plugin Calendar'}
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900">
            {state.calendar.pluginCalendar === 'jalali'
              ? 'هجری شمسی'
              : state.calendar.pluginCalendar === 'hijri'
              ? 'هجری قمری'
              : 'میلادی (Gregorian)'}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {formatCalendarDate(new Date().toISOString(), state.calendar.pluginCalendar, lang, false)}
          </div>
        </div>
      </div>

      {/* Store Settings + Registered Apps */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <form
          onSubmit={handleSave}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'fa' ? 'پیکربندی پایه پلاگین وردپرس و ووکامرس' : 'Core Plugin & WooCommerce Settings'}
              </h2>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                شامل نصب/حذف خودکار پچ پیوندیکتای ساده (`mu-plugins/elm-plain-permalink-fix.php`) و گارد JSON در هنگام نصب افزونه.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {lang === 'fa' ? 'دامنه فروشگاه وردپرس/ووکامرس' : 'WordPress / WooCommerce Store Domain'}
              </label>
              <input
                type="text"
                dir="ltr"
                value={storeDomain}
                onChange={(e) => setStoreDomain(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-700 font-mono"
                placeholder="yektap.ir"
              />
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">
                {lang === 'fa'
                  ? 'وضعیت سفارش ووکامرس برای صدور خودکار لایسنس (مستقل از درگاه پرداخت)'
                  : 'WooCommerce Order Statuses Triggering License Issuance'}
              </div>
              <div className="flex flex-wrap gap-2">
                {(['completed', 'processing', 'on-hold'] as OrderStatus[]).map((st) => {
                  const active = triggerStatuses.includes(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => toggleStatus(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-sky-900 text-white border-sky-900'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {savingSettings ? 'در حال ذخیره...' : 'ذخیره و بروزرسانی ZIP'}
            </button>
            <button
              type="button"
              onClick={onDownloadZip}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>دانلود فایل ZIP پلاگین (۱۵ فایل)</span>
            </button>
          </div>
        </form>

        {/* Registered Apps + Edit / Key Sync */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'fa' ? 'مدیریت اپلیکیشن‌ها و همگام‌سازی کلید Ed25519' : 'Registered Apps & Ed25519 Keys'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                ویرایش کامل، توقف موقت بدون حذف لایسنس‌ها، نمایش همزمان Hex و Base64، و تست زنده امضا
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (showNewApp) resetAppForm();
                else setShowNewApp(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showNewApp ? 'بستن فرم' : 'افزودن / ایمپورت اپ'}</span>
            </button>
          </div>

          {showNewApp && (
            <form onSubmit={handleAppFormSubmit} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="text-xs font-semibold text-slate-800">
                {editingApp ? `ویرایش اپلیکیشن: ${editingApp.name}` : 'ثبت اپلیکیشن جدید یا ایمپورت elm-manifest.json'}
              </div>
              {!editingApp && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <textarea
                    rows={2}
                    dir="ltr"
                    value={manifestJson}
                    onChange={(e) => setManifestJson(e.target.value)}
                    placeholder='{"app_slug":"shop-app","app_name":"فروشگاه من","license_mode":"method2_trial","trial_days":14}'
                    className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleImportManifest}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>خواندن Manifest</span>
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="نام اپلیکیشن"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <input
                  type="text"
                  required
                  disabled={Boolean(editingApp)}
                  dir="ltr"
                  value={appSlug}
                  onChange={(e) => setAppSlug(e.target.value)}
                  placeholder="app-slug-name"
                  className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                />
                <select
                  value={appPlatform}
                  onChange={(e) => setAppPlatform(e.target.value as ElmApp['platform'])}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="android">Android (Kotlin / Gradle)</option>
                  <option value="web">Web (React / Node.js)</option>
                  <option value="cross_platform">Cross-Platform (Android + Web)</option>
                </select>
                <select
                  value={appMode}
                  onChange={(e) => setAppMode(e.target.value as 'method1_gated' | 'method2_trial')}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="method1_gated">روش اول: محدودسازی مستقیم بخش‌ها</option>
                  <option value="method2_trial">روش دوم: دوره Trial + محدودسازی</option>
                </select>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600 whitespace-nowrap">Trial (روز):</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={trialDays}
                    onChange={(e) => setTrialDays(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white tabular-nums"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600 whitespace-nowrap">آفلاین (روز):</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={graceDays}
                    onChange={(e) => setGraceDays(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white tabular-nums"
                  />
                </div>
              </div>
              <input
                type="url"
                dir="ltr"
                value={purchaseUrl}
                onChange={(e) => setPurchaseUrl(e.target.value)}
                placeholder={`https://${storeDomain}/product/...`}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
              />
              <input
                type="text"
                value={gatedText}
                onChange={(e) => setGatedText(e.target.value)}
                placeholder="بخش‌های محدودشده با ویرگول جدا شوند..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />
              {editingApp && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">کلید عمومی ۶۴ کاراکتری Hex (قابل ویرایش):</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={editPubHex}
                      onChange={(e) => setEditPubHex(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-300 rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">یا وارد کردن Seed ۶۴ کاراکتری Hex برای جفت کلید جدید:</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={editSeedHex}
                      onChange={(e) => setEditSeedHex(e.target.value)}
                      placeholder="اختیاری (64 کاراکتر Hex)"
                      className="w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-300 rounded bg-white"
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
                >
                  {editingApp ? 'ذخیره تغییرات اپلیکیشن' : 'ثبت اپلیکیشن و تولید کلید Ed25519'}
                </button>
                {editingApp && (
                  <button
                    type="button"
                    onClick={resetAppForm}
                    className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
                  >
                    انصراف
                  </button>
                )}
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {state.apps.map((app) => (
              <div key={app.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{app.name}</span>
                    <span className={`text-[11px] font-medium ${app.isActive ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {app.isActive ? 'فعال' : 'متوقف‌شده'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 flex flex-wrap items-center gap-2">
                    <span className="font-mono">{app.slug}</span>
                    <span aria-hidden="true">·</span>
                    <span>{app.mode === 'method2_trial' ? `روش ۲ (${app.trialDays} روز Trial)` : 'روش ۱ (محدودسازی مستقیم)'}</span>
                    <span aria-hidden="true">·</span>
                    <span>آفلاین {app.offlineGraceDays} روز</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setKeyModalApp(app);
                      setSigTestResult(null);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-800 hover:bg-slate-100"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-sky-800" />
                    <span>کلید و تست امضا</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditApp(app)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>ویرایش</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onToggleApp(app.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50"
                    title={app.isActive ? 'توقف موقت بدون حذف لایسنس‌ها' : 'فعال‌سازی مجدد'}
                  >
                    {app.isActive ? <PauseCircle className="w-3.5 h-3.5 text-amber-700" /> : <PlayCircle className="w-3.5 h-3.5 text-emerald-700" />}
                    <span>{app.isActive ? 'توقف' : 'فعال‌سازی'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key Sync & Live Signature Test Modal */}
      {keyModalApp && (
        <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-2xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sky-800" />
                <h3 className="text-sm font-semibold text-slate-900">
                  همگام‌سازی کلید عمومی Ed25519 و تست امضا — {keyModalApp.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setKeyModalApp(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="font-medium text-slate-700 mb-1">کلید عمومی ۶۴ کاراکتری Hex (برای `EpicLicenseClient.kt`):</div>
                <div className="flex items-center gap-2">
                  <code dir="ltr" className="flex-1 p-2.5 bg-slate-950 text-sky-300 rounded-lg font-mono text-[11px] break-all">
                    {state.apps.find((a) => a.id === keyModalApp.id)?.publicKeyHex ?? keyModalApp.publicKeyHex}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyCode(state.apps.find((a) => a.id === keyModalApp.id)?.publicKeyHex ?? keyModalApp.publicKeyHex, 'hex_modal')}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 shrink-0"
                  >
                    {copiedPath === 'hex_modal' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <div className="font-medium text-slate-700 mb-1">کلید عمومی Base64 (معادل خام ۳۲ بایتی):</div>
                <div className="flex items-center gap-2">
                  <code dir="ltr" className="flex-1 p-2.5 bg-slate-100 text-slate-800 rounded-lg font-mono text-[11px] break-all">
                    {state.apps.find((a) => a.id === keyModalApp.id)?.publicKeyBase64 ?? keyModalApp.publicKeyBase64}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyCode(state.apps.find((a) => a.id === keyModalApp.id)?.publicKeyBase64 ?? keyModalApp.publicKeyBase64, 'b64_modal')}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 shrink-0"
                  >
                    {copiedPath === 'b64_modal' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => void runLiveSignatureTest(keyModalApp)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>اجرای تست زنده امضا و راستی‌آزمایی</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onUpdateApp(keyModalApp.id, { regenerateKeys: true });
                    await runLiveSignatureTest(keyModalApp);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800 hover:bg-slate-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>تولید جفت کلید جدید همسان</span>
                </button>
              </div>

              {sigTestResult && (
                <div
                  className={`p-3 rounded-lg border text-xs space-y-2 ${
                    sigTestResult.verifiedWithAppHex
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <div className="font-semibold">{sigTestResult.diagnosticMessage}</div>
                  <div dir="ltr" className="font-mono text-[11px] bg-white/80 p-2 rounded border border-slate-200 break-all">
                    Token: {sigTestResult.token}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Live Plugin Source Inspector */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-sky-800" />
            <h3 className="text-sm font-semibold text-slate-900">
              {lang === 'fa' ? 'مرورگر فایل‌های سورس پلاگین وردپرس (۱۵ فایل · PHP 8.2+ / HPOS)' : 'WordPress Plugin Source Inspector'}
            </h3>
          </div>
          {activeFile && (
            <button
              type="button"
              onClick={() => copyCode(activeFile.content, activeFile.path)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap shrink-0"
            >
              {copiedPath === activeFile.path ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedPath === activeFile.path ? 'کپی شد' : 'کپی فایل'}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[420px]">
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-l border-slate-200 bg-slate-50 p-3 space-y-1 max-h-[460px] overflow-y-auto">
            {files.map((file) => {
              const isSelected = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedFile(file.path)}
                  className={`w-full text-start px-3 py-2 rounded-lg text-xs transition-colors flex items-start gap-2 ${
                    isSelected
                      ? 'bg-white border border-slate-300 text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <FileCode2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-800" />
                  <div className="min-w-0">
                    <div className="font-mono truncate" dir="ltr">
                      {file.path.replace('epic-license-manager/', '')}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{file.description}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-8 bg-slate-950 text-slate-100 p-4 overflow-auto max-h-[460px]" dir="ltr">
            <pre className="text-xs font-mono leading-relaxed whitespace-pre">
              <code>{activeFile?.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
