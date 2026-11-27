import React, { useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderOpen, Plus, Upload } from 'lucide-react';
import { formatCalendarDate } from '../shared/calendar.js';
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
  onDownloadZip: () => void;
}

export const PluginBuilderView: React.FC<Props> = ({
  state,
  files,
  lang,
  onSaveWooSettings,
  onCreateApp,
  onDownloadZip,
}) => {
  const [selectedFile, setSelectedFile] = useState<string>(files[0]?.path ?? '');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [storeDomain, setStoreDomain] = useState(state.woocommerce.storeDomain);
  const [triggerStatuses, setTriggerStatuses] = useState<OrderStatus[]>(state.woocommerce.triggerStatuses);
  const [savingSettings, setSavingSettings] = useState(false);

  // New App / Manifest Importer state
  const [showNewApp, setShowNewApp] = useState(false);
  const [manifestJson, setManifestJson] = useState('');
  const [appName, setAppName] = useState('');
  const [appSlug, setAppSlug] = useState('');
  const [appPlatform, setAppPlatform] = useState<'android' | 'web' | 'cross_platform'>('android');
  const [appMode, setAppMode] = useState<'method1_gated' | 'method2_trial'>('method2_trial');
  const [trialDays, setTrialDays] = useState(14);
  const [graceDays, setGraceDays] = useState(14);
  const [gatedText, setGatedText] = useState('خروجی اکسل پیشرفته، گزارش مالیاتی، اتصال ابری');

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
      if (Array.isArray(parsed.gated_features)) {
        setGatedText(parsed.gated_features.map(String).join('، '));
      }
    } catch {
      // Ignore malformed JSON silently; form remains editable
    }
  };

  const handleCreateAppSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appName.trim() || !appSlug.trim()) return;
    await onCreateApp({
      slug: appSlug,
      name: appName,
      platform: appPlatform,
      mode: appMode,
      trialDays,
      offlineGraceDays: graceDays,
      purchaseUrl: `https://${storeDomain}/product/${appSlug.trim().toLowerCase()}`,
      gatedFeatures: gatedText
        .split(/[،,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setAppName('');
    setAppSlug('');
    setManifestJson('');
    setShowNewApp(false);
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
            {lang === 'fa' ? 'سازگار با WooCommerce HPOS و PHP 8.2+' : 'WooCommerce HPOS & PHP 8.2+ Ready'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">
            {lang === 'fa' ? 'اپلیکیشن‌های متصل' : 'Registered Apps'}
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{state.apps.length}</div>
          <div className="mt-1 text-xs text-slate-500">
            {lang === 'fa' ? 'امضای دیجیتال Ed25519 فعال' : 'Ed25519 Offline Token Signing'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">
            {lang === 'fa' ? 'نصب مجدد مسدودشده Trial' : 'Blocked Trial Reinstalls'}
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-700 tabular-nums">{trialBlocked}</div>
          <div className="mt-1 text-xs text-slate-500">
            {lang === 'fa' ? 'محافظت سخت‌افزاری سمت سرور' : 'Server Hardware Fingerprint Guard'}
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
                {lang === 'fa'
                  ? 'این مقادیر مستقیماً در فایل‌های PHP داخل بسته ZIP دانلودی اعمال می‌شوند.'
                  : 'Values applied directly inside the generated downloadable WordPress plugin ZIP.'}
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
              {savingSettings
                ? lang === 'fa' ? 'در حال ذخیره...' : 'Saving...'
                : lang === 'fa' ? 'ذخیره و بروزرسانی ZIP' : 'Save & Update ZIP'}
            </button>
            <button
              type="button"
              onClick={onDownloadZip}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'fa' ? 'دانلود فایل ZIP پلاگین' : 'Download Plugin ZIP'}</span>
            </button>
          </div>
        </form>

        {/* Registered Apps + Quick Manifest Import */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {lang === 'fa' ? 'سیستم‌های لایسنس اپلیکیشن‌ها (Handshake)' : 'Registered Application Systems'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'fa'
                  ? 'افزودن دستی یا ایمپورت مستقیم فایل elm-manifest.json تولیدشده توسط هوش مصنوعی'
                  : 'Register manually or import elm-manifest.json generated by AI Studio'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewApp((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showNewApp ? (lang === 'fa' ? 'بستن فرم' : 'Close') : lang === 'fa' ? 'افزودن / ایمپورت اپ' : 'Add / Import App'}</span>
            </button>
          </div>

          {showNewApp && (
            <form onSubmit={handleCreateAppSubmit} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
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
                  <span>{lang === 'fa' ? 'خواندن Manifest' : 'Parse Manifest'}</span>
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder={lang === 'fa' ? 'نام اپلیکیشن (مثلا: حسابدار همراه)' : 'App Name'}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={appSlug}
                  onChange={(e) => setAppSlug(e.target.value)}
                  placeholder="app-slug-name"
                  className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
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
                type="text"
                value={gatedText}
                onChange={(e) => setGatedText(e.target.value)}
                placeholder="بخش‌های محدودشده با ویرگول جدا شوند..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
              >
                {lang === 'fa' ? 'ثبت اپلیکیشن و تولید کلید Ed25519' : 'Register App & Generate Keys'}
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100">
            {state.apps.map((app) => (
              <div key={app.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{app.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500 flex flex-wrap items-center gap-2">
                    <span className="font-mono">{app.slug}</span>
                    <span aria-hidden="true">·</span>
                    <span>{app.mode === 'method2_trial' ? `روش ۲ (${app.trialDays} روز Trial)` : 'روش ۱ (محدودسازی مستقیم)'}</span>
                    <span aria-hidden="true">·</span>
                    <span>همگام‌سازی آفلاین هر {app.offlineGraceDays} روز</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyCode(app.publicKeyHex, app.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  {copiedPath === app.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>PubKey: {app.publicKeyHex.slice(0, 12)}...</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Plugin Source Inspector */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-sky-800" />
            <h3 className="text-sm font-semibold text-slate-900">
              {lang === 'fa' ? 'مرورگر فایل‌های سورس پلاگین وردپرس (PHP 8.2+ / HPOS)' : 'WordPress Plugin Source Inspector'}
            </h3>
          </div>
          {activeFile && (
            <button
              type="button"
              onClick={() => copyCode(activeFile.content, activeFile.path)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 whitespace-nowrap shrink-0"
            >
              {copiedPath === activeFile.path ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedPath === activeFile.path ? (lang === 'fa' ? 'کپی شد' : 'Copied') : lang === 'fa' ? 'کپی فایل' : 'Copy File'}</span>
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
