import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Megaphone, Sparkles } from 'lucide-react';
import { toPersianDigits } from '../shared/calendar.js';
import type { PromoConfig, SimulatorState } from '../shared/types.js';

interface Props {
  state: SimulatorState;
  lang: 'fa' | 'en';
  onSavePromo: (patch: Partial<PromoConfig> & { autoBuildHtml?: boolean }) => Promise<void>;
}

export const PromoBuilderView: React.FC<Props> = ({ state, onSavePromo }) => {
  const initial = state.promos[0];
  const [form, setForm] = useState<PromoConfig>(initial);
  const [builderTab, setBuilderTab] = useState<'visual' | 'html'>('visual');
  const [saved, setSaved] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const selectPromo = (id: string) => {
    const found = state.promos.find((p) => p.id === id);
    if (found) setForm(found);
  };

  const toggleVariation = (varId: string) => {
    setForm((prev) => {
      const nextIds = prev.selectedVariationIds.includes(varId)
        ? prev.selectedVariationIds.filter((x) => x !== varId)
        : [...prev.selectedVariationIds, varId];
      return { ...prev, selectedVariationIds: nextIds };
    });
  };

  const handleSave = async (e: React.FormEvent, autoBuild = builderTab === 'visual') => {
    e.preventDefault();
    await onSavePromo({ ...form, autoBuildHtml: autoBuild });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const fullPromoUrl = `https://${state.woocommerce.storeDomain}/elm-promo/${form.slug}`;
  const previewSrc = `/elm-promo/${encodeURIComponent(form.slug)}`;

  const copyLink = async () => {
    await navigator.clipboard.writeText(fullPromoUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1600);
  };

  const appVariations = state.variations.filter((v) => v.appSlug === form.appSlug || form.appSlug === '');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <form onSubmit={(e) => handleSave(e, builderTab === 'visual')} className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-sky-800" />
            <h2 className="text-base font-semibold text-slate-900">
              طراح بصری تبلیغات HTML موبایل و لینک اختصاصی (CPT `elm_promo`)
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

        {/* Dedicated CPT Permalink Box */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <div className="text-slate-500">لینک اختصاصی بدون هدر/فوتر قالب برای WebView اپلیکیشن:</div>
            <div dir="ltr" className="font-mono text-sky-900 font-medium truncate mt-0.5">
              {fullPromoUrl}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>کپی لینک</span>
            </button>
            <a
              href={previewSrc}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-800"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>باز کردن صفحه</span>
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">اپلیکیشن هدف</label>
            <select
              value={form.appSlug}
              onChange={(e) => setForm({ ...form, appSlug: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              {state.apps.map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">نامک لینک اختصاصی (Slug)</label>
            <input
              type="text"
              dir="ltr"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">تبلیغ ذخیره‌شده</label>
            <select
              value={form.id}
              onChange={(e) => selectPromo(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              {state.promos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
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
            <label className="block text-xs font-medium text-slate-700 mb-1">بازه نمایش (ثانیه)</label>
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
              <span>نمایش با کلیک بخش قفل</span>
            </label>
          </div>
        </div>

        {/* Mode Switch: Visual Builder vs Raw HTML */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setBuilderTab('visual')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 ${
              builderTab === 'visual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>فرم بصری اتصال به ووکامرس</span>
          </button>
          <button
            type="button"
            onClick={() => setBuilderTab('html')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${
              builderTab === 'html' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            ویرایشگر مستقیم کد HTML
          </button>
        </div>

        {builderTab === 'visual' ? (
          <div className="space-y-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">تیتر اصلی پیشنهاد</label>
                <input
                  type="text"
                  value={form.headline}
                  onChange={(e) => setForm({ ...form, headline: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">رنگ تم (Theme)</label>
                <input
                  type="color"
                  value={form.themeColor}
                  onChange={(e) => setForm({ ...form, themeColor: e.target.value })}
                  className="w-full h-9 p-1 border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">برچسب تخفیف</label>
                <input
                  type="text"
                  value={form.discountBadge}
                  onChange={(e) => setForm({ ...form, discountBadge: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">توضیح کوتاه</label>
                <input
                  type="text"
                  value={form.subheadline}
                  onChange={(e) => setForm({ ...form, subheadline: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-700">انتخاب متغیرهای واقعی ووکامرس برای نمایش کارت قیمت:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {appVariations.map((v) => {
                  const checked = form.selectedVariationIds.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`flex items-center justify-between gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                        checked ? 'bg-white border-sky-700 text-slate-900' : 'bg-white/60 border-slate-200 text-slate-600'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleVariation(v.id)}
                        />
                        <span className="truncate">{v.variationLabel}</span>
                      </span>
                      <span className="font-semibold tabular-nums shrink-0">
                        {toPersianDigits(v.bundlePriceToman.toLocaleString())} ت
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              کد HTML خام تبلیغ (همگام با API و صفحه CPT `elm_promo`)
            </label>
            <textarea
              rows={9}
              dir="ltr"
              value={form.htmlContent}
              onChange={(e) => setForm({ ...form, htmlContent: e.target.value })}
              className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-lg bg-slate-50"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">متن دکمه خرید</label>
            <input
              type="text"
              value={form.ctaLabel}
              onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">لینک مستقیم محصول / سبد خرید ووکامرس</label>
            <input
              type="url"
              dir="ltr"
              value={form.ctaUrl}
              onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <button
          type="submit"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
        >
          {saved && <Check className="w-3.5 h-3.5" />}
          <span>{saved ? 'ذخیره و بازسازی شد' : 'ذخیره تبلیغ در CPT و API'}</span>
        </button>
      </form>

      {/* Live Preview of Lightweight CPT Page */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="text-sm font-semibold text-slate-900">
          پیش‌نمایش زنده لینک اختصاصی WebView ({form.permalinkPath})
        </div>
        <div className="bg-slate-100 rounded-xl p-3 border border-slate-200">
          <iframe
            title="CPT Promo Live Preview"
            src={previewSrc}
            className="w-full h-[460px] border-0 rounded-lg bg-white"
          />
        </div>
      </div>
    </div>
  );
};
