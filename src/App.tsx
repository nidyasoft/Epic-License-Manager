import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  CalendarCog,
  Download,
  FileSpreadsheet,
  Languages,
  Megaphone,
  PackageCheck,
  RotateCcw,
  Smartphone,
} from 'lucide-react';
import { CalendarWooView } from './components/CalendarWooView.js';
import { PhoneApiLabView } from './components/PhoneApiLabView.js';
import { PluginBuilderView } from './components/PluginBuilderView.js';
import { PromoBuilderView } from './components/PromoBuilderView.js';
import { ReportsView } from './components/ReportsView.js';
import { SdkDocsView } from './components/SdkDocsView.js';
import type {
  CalendarSettings,
  LicenseDuration,
  OrderStatus,
  PluginVirtualFile,
  PromoConfig,
  SimulatorState,
} from './shared/types.js';

type NavSection = 'plugin' | 'calendar_woo' | 'phone_lab' | 'promo' | 'reports' | 'sdk';

export default function App() {
  const [section, setSection] = useState<NavSection>('plugin');
  const [lang, setLang] = useState<'fa' | 'en'>('fa');
  const [state, setState] = useState<SimulatorState | null>(null);
  const [files, setFiles] = useState<PluginVirtualFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [simRes, filesRes] = await Promise.all([
        fetch('/api/sim/state'),
        fetch('/api/plugin/files'),
      ]);
      if (!simRes.ok || !filesRes.ok) {
        throw new Error('خطا در دریافت اطلاعات از سرور');
      }
      const simJson = (await simRes.json()) as { state: SimulatorState };
      const filesJson = (await filesRes.json()) as { files: PluginVirtualFile[] };
      setState(simJson.state);
      setFiles(filesJson.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleDownloadZip = () => {
    window.location.href = '/api/plugin/download';
  };

  const handleSaveWooSettings = async (patch: { storeDomain: string; triggerStatuses: OrderStatus[] }) => {
    await fetch('/api/sim/settings/woocommerce', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadAll();
  };

  const handleCreateApp = async (app: {
    slug: string;
    name: string;
    platform: 'android' | 'web' | 'cross_platform';
    mode: 'method1_gated' | 'method2_trial';
    trialDays: number;
    offlineGraceDays: number;
    purchaseUrl: string;
    gatedFeatures: string[];
  }) => {
    await fetch('/api/sim/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(app),
    });
    await loadAll();
  };

  const handleUpdateCalendar = async (cal: CalendarSettings) => {
    await fetch('/api/sim/settings/calendar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cal),
    });
    await loadAll();
  };

  const handleUpsertVariation = async (v: {
    productName: string;
    variationLabel: string;
    appSlug: string;
    duration: LicenseDuration;
    licenseQuantity: number;
    regularPriceToman: number;
    bundlePriceToman: number;
  }) => {
    await fetch('/api/sim/products/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    });
    await loadAll();
  };

  const handleCheckout = async (payload: {
    isGuestAttempt: boolean;
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    variationId: string;
    quantityOrdered: number;
    initialStatus: OrderStatus;
  }) => {
    const res = await fetch('/api/sim/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; error?: string; issuedLicenses?: unknown[] };
    await loadAll();
    return { ok: data.ok, error: data.error, issuedCount: data.issuedLicenses?.length ?? 0 };
  };

  const handleUpdateOrderStatus = async (orderId: number, status: OrderStatus) => {
    await fetch(`/api/sim/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadAll();
  };

  const handleSavePromo = async (patch: Partial<PromoConfig>) => {
    await fetch('/api/sim/promo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadAll();
  };

  const handleReset = async () => {
    await fetch('/api/sim/reset', { method: 'POST' });
    await loadAll();
  };

  const navItems: { id: NavSection; labelFa: string; labelEn: string; icon: typeof PackageCheck }[] = [
    { id: 'plugin', labelFa: 'بسته‌ساز و کد پلاگین ZIP', labelEn: 'Plugin ZIP & Source', icon: PackageCheck },
    { id: 'calendar_woo', labelFa: 'تقویم سه‌گانه و ووکامرس', labelEn: 'Calendars & WooCommerce', icon: CalendarCog },
    { id: 'phone_lab', labelFa: 'تستر API و شبیه‌ساز گوشی', labelEn: 'Live API & Phone Lab', icon: Smartphone },
    { id: 'promo', labelFa: 'تبلیغات HTML موبایل', labelEn: 'HTML Mobile Promos', icon: Megaphone },
    { id: 'reports', labelFa: 'گزارش جامع و فیلدهای ACF', labelEn: 'Reports & ACF Export', icon: FileSpreadsheet },
    { id: 'sdk', labelFa: 'مستندات SDK و AI Studio', labelEn: 'SDK & AI Studio Prompt', icon: BookOpen },
  ];

  const activeNav = navItems.find((n) => n.id === section) ?? navItems[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[260px] shrink-0 bg-white border-b lg:border-b-0 lg:border-e border-slate-200 flex flex-col justify-between">
        <div className="p-5 space-y-6">
          <div className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Epic License Manager
          </div>

          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 text-start ${
                    active
                      ? 'bg-sky-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{lang === 'fa' ? item.labelFa : item.labelEn}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'fa' ? 'en' : 'fa'))}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{lang === 'fa' ? 'English' : 'فارسی'}</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{lang === 'fa' ? 'بازنشانی' : 'Reset'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean 3-zone / SaaS Top Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
          <div className="text-sm font-medium text-slate-600 truncate">
            <span>Epic License Manager</span>
            <span className="mx-2 text-slate-300">/</span>
            <span className="text-slate-900 font-semibold">
              {lang === 'fa' ? activeNav.labelFa : activeNav.labelEn}
            </span>
          </div>

          <button
            type="button"
            onClick={handleDownloadZip}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{lang === 'fa' ? 'دانلود پلاگین (ZIP)' : 'Download Plugin ZIP'}</span>
          </button>
        </header>

        <main className="flex-1 p-5 lg:p-6 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
                ))}
              </div>
              <div className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : error || !state ? (
            <div className="p-6 bg-white border border-red-200 rounded-xl text-sm text-red-800 space-y-3">
              <div>{error || 'خطا در بارگذاری داده‌ها'}</div>
              <button
                type="button"
                onClick={() => void loadAll()}
                className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg"
              >
                تلاش مجدد
              </button>
            </div>
          ) : (
            <>
              {section === 'plugin' && (
                <PluginBuilderView
                  state={state}
                  files={files}
                  lang={lang}
                  onSaveWooSettings={handleSaveWooSettings}
                  onCreateApp={handleCreateApp}
                  onDownloadZip={handleDownloadZip}
                />
              )}
              {section === 'calendar_woo' && (
                <CalendarWooView
                  state={state}
                  lang={lang}
                  onUpdateCalendar={handleUpdateCalendar}
                  onUpsertVariation={handleUpsertVariation}
                  onCheckout={handleCheckout}
                  onUpdateOrderStatus={handleUpdateOrderStatus}
                />
              )}
              {section === 'phone_lab' && (
                <PhoneApiLabView state={state} lang={lang} onRefreshState={loadAll} />
              )}
              {section === 'promo' && (
                <PromoBuilderView state={state} lang={lang} onSavePromo={handleSavePromo} />
              )}
              {section === 'reports' && <ReportsView state={state} lang={lang} />}
              {section === 'sdk' && <SdkDocsView state={state} lang={lang} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
