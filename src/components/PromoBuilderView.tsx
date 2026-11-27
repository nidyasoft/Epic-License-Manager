import React, { useState } from 'react';
import { Megaphone, Check } from 'lucide-react';
import type { PromoConfig, SimulatorState } from '../shared/types.js';

interface Props {
  state: SimulatorState;
  lang: 'fa' | 'en';
  onSavePromo: (patch: Partial<PromoConfig>) => Promise<void>;
}

export const PromoBuilderView: React.FC<Props> = ({ state, onSavePromo }) => {
  const [form, setForm] = useState<PromoConfig>(state.promo);
  const [saved, setSaved] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSavePromo(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <form onSubmit={handleSave} className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-sky-800" />
            <h2 className="text-base font-semibold text-slate-900">
              طراح پیام‌های تبلیغاتی HTML و آفرهای بسته‌ای روی گوشی
            </h2>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>فعال روی اپلیکیشن</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">حالت نمایش</label>
            <select
              value={form.displayMode}
              onChange={(e) => setForm({ ...form, displayMode: e.target.value as PromoConfig['displayMode'] })}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              <option value="floating_modal">صفحه شناور (Floating Dialog)</option>
              <option value="inline_banner">کادر درون‌صفحه‌ای (Inline Card)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">بازه نمایش دوره‌ای (ثانیه)</label>
            <input
              type="number"
              min={15}
              max={3600}
              value={form.intervalSeconds}
              onChange={(e) => setForm({ ...form, intervalSeconds: Number(e.target.value) })}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg tabular-nums"
            />
          </div>
          <div className="flex items-end">
            <label className="w-full flex items-center gap-2 p-2 border border-slate-200 rounded-lg text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.showOnLockedClick}
                onChange={(e) => setForm({ ...form, showOnLockedClick: e.target.checked })}
              />
              <span>نمایش هنگام کلیک بخش قفل</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">متن دکمه انتقال به فروشگاه</label>
            <input
              type="text"
              value={form.ctaLabel}
              onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">لینک مستقیم محصول در ووکامرس</label>
            <input
              type="url"
              dir="ltr"
              value={form.ctaUrl}
              onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            کد HTML تبلیغات و آفر تخفیف (ارسالی از API /wp-json/elm/v1/promo)
          </label>
          <textarea
            rows={10}
            dir="ltr"
            value={form.htmlContent}
            onChange={(e) => setForm({ ...form, htmlContent: e.target.value })}
            className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-lg bg-slate-50"
          />
        </div>

        <button
          type="submit"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
        >
          {saved && <Check className="w-3.5 h-3.5" />}
          <span>{saved ? 'ذخیره شد' : 'ذخیره تنظیمات تبلیغات در API'}</span>
        </button>
      </form>

      {/* Live Preview */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="text-sm font-semibold text-slate-900">
          پیش‌نمایش زنده روی گوشی ({form.displayMode === 'floating_modal' ? 'کادر شناور' : 'بنر درون‌صفحه‌ای'})
        </div>
        <div className="bg-slate-100 rounded-xl p-4 border border-slate-200">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs space-y-3">
            <iframe
              title="HTML Promo Sandbox"
              sandbox=""
              srcDoc={`<!doctype html><html dir="rtl" lang="fa"><body style="margin:0;padding:4px;">${form.htmlContent}</body></html>`}
              className="w-full h-48 border-0"
            />
            <a
              href={form.ctaUrl}
              target="_blank"
              rel="noreferrer"
              className="block w-full py-2.5 px-4 text-xs font-medium text-center bg-sky-800 text-white rounded-lg hover:bg-sky-900"
            >
              {form.ctaLabel}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
