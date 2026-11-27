import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Columns3, FileSpreadsheet, Search } from 'lucide-react';
import { formatCalendarDate, formatRemainingTime, toPersianDigits } from '../shared/calendar.js';
import type { CustomerExtraFields, ElmLicense, LicenseStatus, SimulatorState } from '../shared/types.js';

interface Props {
  state: SimulatorState;
  lang: 'fa' | 'en';
}

type SortField = 'orderId' | 'createdAt' | 'expiresAt' | 'status';

export const ReportsView: React.FC<Props> = ({ state, lang }) => {
  const [search, setSearch] = useState('');
  const [appFilter, setAppFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | LicenseStatus>('all');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [selectedExtraKeys, setSelectedExtraKeys] = useState<Array<keyof CustomerExtraFields>>([
    'wc_billing_city',
    'acf_national_id',
    'acf_support_tier',
  ]);

  const toggleExtraKey = (key: keyof CustomerExtraFields) => {
    setSelectedExtraKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = state.licenses.filter((lic) => {
      if (appFilter !== 'all' && lic.appSlug !== appFilter) return false;
      if (statusFilter !== 'all' && lic.status !== statusFilter) return false;
      if (q) {
        const hay = `${lic.licenseKey} ${lic.customerFirstName} ${lic.customerLastName} ${lic.customerMobile} ${lic.customerEmail}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'orderId') {
        cmp = a.orderId - b.orderId;
      } else if (sortField === 'status') {
        cmp = a.status.localeCompare(b.status);
      } else if (sortField === 'expiresAt') {
        const ta = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        const tb = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        cmp = ta - tb;
      } else {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [state.licenses, search, appFilter, statusFilter, sortField, sortDir]);

  const exportUrl = (format: 'xls' | 'csv') =>
    `/api/report/export?format=${format}&lang=${lang}&extra=${encodeURIComponent(selectedExtraKeys.join(','))}`;

  const renderExtraValue = (lic: ElmLicense, key: keyof CustomerExtraFields) => {
    const raw = lic.customerMeta[key];
    if (key === 'wp_user_registered' && typeof raw === 'string') {
      return formatCalendarDate(raw, state.calendar.pluginCalendar, lang, false);
    }
    if (typeof raw === 'number') {
      return lang === 'fa' ? toPersianDigits(raw.toLocaleString()) : raw.toLocaleString();
    }
    return String(raw ?? '—');
  };

  const activeExtraDefs = state.availableExtraFields.filter((f) => selectedExtraKeys.includes(f.key));

  return (
    <div className="space-y-4">
      {/* Filter, Dynamic ACF Column Picker & Export Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جست‌وجو در کلید، نام مشتری، موبایل یا ایمیل..."
                className="w-full ps-9 pe-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-700"
              />
            </div>

            <select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">همه اپلیکیشن‌ها</option>
              {state.apps.map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | LicenseStatus)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="active">فعال (Active)</option>
              <option value="expired">منقضی (Expired)</option>
              <option value="revoked">لغوشده (Revoked)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowColumnPicker((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Columns3 className="w-3.5 h-3.5 text-sky-800" />
              <span>فیلدهای اضافه (WP / WC / ACF)</span>
            </button>

            <a
              href={exportUrl('xls')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>خروجی اکسل (.xls)</span>
            </a>

            <a
              href={exportUrl('csv')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 bg-slate-50 text-slate-800 rounded-lg hover:bg-slate-100 whitespace-nowrap"
            >
              <span>CSV (UTF-8)</span>
            </a>
          </div>
        </div>

        {/* Dynamic Field Picker (WordPress + WooCommerce + ACF) */}
        {showColumnPicker && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
            <div className="text-xs font-semibold text-slate-800">
              انتخاب فیلدهای پویا از وردپرس، ووکامرس و Advanced Custom Fields (ACF) برای افزودن به گزارش و خروجی اکسل:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {state.availableExtraFields.map((field) => {
                const checked = selectedExtraKeys.includes(field.key);
                return (
                  <label
                    key={field.key}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'bg-white border-sky-700 text-slate-900'
                        : 'bg-white/60 border-slate-200 text-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExtraKey(field.key)}
                      />
                      <span>{lang === 'fa' ? field.labelFa : field.labelEn}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">{field.source.toUpperCase()}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* License Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">کلید لایسنس</th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">اپلیکیشن</th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort('orderId')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>سفارش</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">نام مشتری</th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">موبایل</th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">ایمیل</th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort('expiresAt')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>مدت باقی‌مانده</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">تاریخ انقضا ({state.calendar.pluginCalendar})</th>
                <th className="py-3 px-3 text-start font-medium whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort('status')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>وضعیت</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                {activeExtraDefs.map((col) => (
                  <th key={col.key} className="py-3 px-3 text-start font-medium whitespace-nowrap text-sky-900">
                    {lang === 'fa' ? col.labelFa : col.labelEn}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={9 + activeExtraDefs.length} className="py-10 text-center text-slate-500">
                    هیچ لایسنسی با فیلترهای انتخاب‌شده یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((lic) => (
                  <tr key={lic.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-mono text-sky-900 whitespace-nowrap">{lic.licenseKey}</td>
                    <td className="py-2.5 px-3 text-slate-800 whitespace-nowrap">{lic.appName}</td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-700 whitespace-nowrap">#{lic.orderId}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-900 whitespace-nowrap">
                      {lic.customerFirstName} {lic.customerLastName}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap" dir="ltr">
                      {lic.customerMobile}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap" dir="ltr">
                      {lic.customerEmail}
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-800 whitespace-nowrap">
                      {formatRemainingTime(lic.expiresAt, lang)}
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-700 whitespace-nowrap">
                      {lic.expiresAt
                        ? formatCalendarDate(lic.expiresAt, state.calendar.pluginCalendar, lang, false)
                        : 'همیشگی'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          lic.status === 'active'
                            ? 'text-emerald-700'
                            : lic.status === 'expired'
                            ? 'text-amber-700'
                            : 'text-red-700'
                        }`}
                      >
                        {lic.status === 'active' ? 'فعال' : lic.status === 'expired' ? 'منقضی' : 'لغوشده'}
                      </span>
                    </td>
                    {activeExtraDefs.map((col) => (
                      <td key={col.key} className="py-2.5 px-3 text-slate-700 whitespace-nowrap tabular-nums">
                        {renderExtraValue(lic, col.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
