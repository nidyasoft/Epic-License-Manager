import React, { useState } from 'react';
import { Calendar, Plus, ShoppingBag, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { formatCalendarDate, toPersianDigits } from '../shared/calendar.js';
import type {
  CalendarSettings,
  CalendarType,
  LicenseDuration,
  OrderStatus,
  SimulatorState,
} from '../shared/types.js';

interface Props {
  state: SimulatorState;
  lang: 'fa' | 'en';
  onUpdateCalendar: (cal: CalendarSettings) => Promise<void>;
  onUpsertVariation: (v: {
    productName: string;
    variationLabel: string;
    appSlug: string;
    duration: LicenseDuration;
    licenseQuantity: number;
    regularPriceToman: number;
    bundlePriceToman: number;
  }) => Promise<void>;
  onCheckout: (payload: {
    hasLicensedProduct: boolean;
    isGuestAttempt: boolean;
    createAccountAtCheckout: boolean;
    paymentMethod: string;
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    variationId: string;
    quantityOrdered: number;
    initialStatus: OrderStatus;
  }) => Promise<{ ok: boolean; error?: string; issuedCount?: number }>;
  onUpdateOrderStatus: (orderId: number, status: OrderStatus) => Promise<void>;
}

export const CalendarWooView: React.FC<Props> = ({
  state,
  lang,
  onUpdateCalendar,
  onUpsertVariation,
  onCheckout,
  onUpdateOrderStatus,
}) => {
  const sampleDateIso = new Date().toISOString();

  // New Variable Bundle Form
  const [varLabel, setVarLabel] = useState('بسته ۳ ماهه تیمی — ۴ لایسنس');
  const [varAppSlug, setVarAppSlug] = useState(state.apps[0]?.slug ?? 'yektap-crm-mobile');
  const [varDuration, setVarDuration] = useState<LicenseDuration>('3m');
  const [varQty, setVarQty] = useState(4);
  const [varRegPrice, setVarRegPrice] = useState(1000000);
  const [varBundlePrice, setVarBundlePrice] = useState(640000);

  // Conditional Cart Checkout Simulator
  const [hasLicensedProduct, setHasLicensedProduct] = useState(true);
  const [isGuestAttempt, setIsGuestAttempt] = useState(true);
  const [createAccountAtCheckout, setCreateAccountAtCheckout] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('زرین‌پال (Zarinpal)');
  const [firstName, setFirstName] = useState('نیما');
  const [lastName, setLastName] = useState('فرهادی');
  const [mobile, setMobile] = useState('09129876543');
  const [email, setEmail] = useState('nima.farhadi@example.ir');
  const [selectedVariationId, setSelectedVariationId] = useState(state.variations[1]?.id ?? state.variations[0]?.id ?? '');
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('completed');
  const [checkoutMsg, setCheckoutMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleCalChange = async (zone: keyof CalendarSettings, value: CalendarType) => {
    await onUpdateCalendar({ ...state.calendar, [zone]: value });
  };

  const handleAddVariation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!varLabel.trim()) return;
    await onUpsertVariation({
      productName: 'اشتراک نرم‌افزار',
      variationLabel: varLabel.trim(),
      appSlug: varAppSlug,
      duration: varDuration,
      licenseQuantity: varQty,
      regularPriceToman: varRegPrice,
      bundlePriceToman: varBundlePrice,
    });
    setVarLabel('');
  };

  const handleSimulateCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutMsg(null);
    const res = await onCheckout({
      hasLicensedProduct,
      isGuestAttempt,
      createAccountAtCheckout,
      paymentMethod,
      firstName,
      lastName,
      mobile,
      email,
      variationId: selectedVariationId,
      quantityOrdered: 1,
      initialStatus: orderStatus,
    });
    if (res.ok) {
      setCheckoutMsg({
        type: 'ok',
        text: !hasLicensedProduct
          ? 'سفارش محصول غیرلایسنسی با تسویه‌حساب مهمان ووکامرس ثبت شد (پلاگین هیچ دخالتی در محصولات عادی نکرد).'
          : res.issuedCount && res.issuedCount > 0
          ? `سفارش با حساب کاربری مشتری ثبت شد و ${res.issuedCount} کلید لایسنس مجزا صادر گردید.`
          : `سفارش با وضعیت ${orderStatus} ثبت شد (در انتظار وضعیت مجاز برای صدور کلید).`,
      });
    } else {
      setCheckoutMsg({ type: 'err', text: res.error || 'خطا در ثبت سفارش' });
    }
  };

  const renderCalOption = (zone: keyof CalendarSettings, title: string, desc: string) => (
    <div className="p-4 border border-slate-200 rounded-xl bg-white space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
      </div>
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
        {(
          [
            { id: 'gregorian', label: 'میلادی' },
            { id: 'jalali', label: 'شمسی' },
            { id: 'hijri', label: 'قمری' },
          ] as { id: CalendarType; label: string }[]
        ).map((opt) => {
          const active = state.calendar[zone] === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleCalChange(zone, opt.id)}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                active ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
        <span className="text-slate-500">{lang === 'fa' ? 'خروجی زنده:' : 'Live Date:'}</span>
        <span className="font-medium text-sky-900 tabular-nums">
          {formatCalendarDate(sampleDateIso, state.calendar[zone], lang, true)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Independent 3-Zone Calendar Settings */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-sky-800" />
          <h2 className="text-base font-semibold text-slate-900">
            موتور تقویم سه‌گانه مستقل (بدون دستکاری فایل‌های هسته وردپرس)
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {renderCalOption(
            'publicCalendar',
            'بخش عمومی وب‌سایت (Public)',
            'تاریخ نوشته‌ها، صفحات و حساب کاربری مشتریان ووکامرس'
          )}
          {renderCalOption(
            'adminCalendar',
            'پیشخوان ادمین وردپرس (WP Admin)',
            'جدول سفارش‌ها، کاربران و تاریخ‌های پیشخوان مدیریت'
          )}
          {renderCalOption(
            'pluginCalendar',
            'رابط اختصاصی پلاگین (Plugin UI)',
            'گزارش فروش لایسنس، زمان انقضا و خروجی اکسل'
          )}
        </div>
      </div>

      {/* Variable Product Bundles + Conditional Cart Checkout Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              نگاشت متغیرهای ووکامرس (بسته‌های ۱ تا ۱۰ لایسنس با قیمت تشویقی)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              قیمت‌گذاری کاملاً در ووکامرس انجام می‌شود؛ پلاگین تشخیص می‌دهد هر متغیر چند لایسنس مجزا تولید کند.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">نام متغیر ووکامرس</th>
                  <th className="py-2 text-start font-medium">مدت</th>
                  <th className="py-2 text-start font-medium">تعداد لایسنس</th>
                  <th className="py-2 text-start font-medium">قیمت اصلی / بسته (تومان)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.variations.map((v) => {
                  const discount = Math.round(((v.regularPriceToman - v.bundlePriceToman) / v.regularPriceToman) * 100);
                  return (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="py-2.5 pe-2">
                        <div className="font-medium text-slate-900">{v.variationLabel}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{v.appSlug}</div>
                      </td>
                      <td className="py-2.5 tabular-nums text-slate-700">{v.duration}</td>
                      <td className="py-2.5 tabular-nums font-semibold text-sky-900">
                        {toPersianDigits(v.licenseQuantity)} کلید مجزا
                      </td>
                      <td className="py-2.5 tabular-nums">
                        <span className="font-semibold text-slate-900">
                          {toPersianDigits(v.bundlePriceToman.toLocaleString())}
                        </span>
                        {discount > 0 && (
                          <span className="ms-2 text-emerald-700">({toPersianDigits(discount)}٪ تخفیف)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form onSubmit={handleAddVariation} className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-6 gap-2.5">
            <input
              type="text"
              value={varLabel}
              onChange={(e) => setVarLabel(e.target.value)}
              placeholder="عنوان متغیر (مثلا: بسته ۲ لایسنس)"
              className="sm:col-span-3 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <select
              value={varAppSlug}
              onChange={(e) => setVarAppSlug(e.target.value)}
              className="sm:col-span-3 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              {state.apps.map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              value={varDuration}
              onChange={(e) => setVarDuration(e.target.value as LicenseDuration)}
              className="sm:col-span-2 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              <option value="1m">۱ ماهه</option>
              <option value="3m">۳ ماهه</option>
              <option value="1y">۱ ساله</option>
              <option value="lifetime">همیشگی</option>
            </select>
            <input
              type="number"
              min={1}
              max={10}
              value={varQty}
              onChange={(e) => setVarQty(Number(e.target.value))}
              className="sm:col-span-1 px-3 py-2 text-xs border border-slate-300 rounded-lg tabular-nums"
              title="تعداد کلید (۱ تا ۱۰)"
            />
            <input
              type="number"
              value={varRegPrice}
              onChange={(e) => setVarRegPrice(Number(e.target.value))}
              placeholder="قیمت عادی"
              className="sm:col-span-1 px-2.5 py-2 text-xs border border-slate-300 rounded-lg tabular-nums"
            />
            <input
              type="number"
              value={varBundlePrice}
              onChange={(e) => setVarBundlePrice(Number(e.target.value))}
              placeholder="قیمت بسته"
              className="sm:col-span-1 px-2.5 py-2 text-xs border border-slate-300 rounded-lg tabular-nums"
            />
            <button
              type="submit"
              className="sm:col-span-1 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>افزودن</span>
            </button>
          </form>
        </div>

        {/* Conditional Cart-Based Checkout Simulator */}
        <form
          onSubmit={handleSimulateCheckout}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-sky-800" />
            <h2 className="text-base font-semibold text-slate-900">
              شبیه‌ساز تسویه‌حساب شرطی ووکامرس
            </h2>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            فیلدهای صورتحساب و خرید مهمان ووکامرس تغییر عمومی نمی‌کنند؛ فقط اگر سبد خرید شامل محصول لایسنس‌دار باشد، کاربر مهمان ملزم به ورود یا ایجاد حساب در تسویه‌حساب می‌شود.
          </p>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setHasLicensedProduct(true)}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md ${
                hasLicensedProduct ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              سبد شامل لایسنس اپیک
            </button>
            <button
              type="button"
              onClick={() => setHasLicensedProduct(false)}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md ${
                !hasLicensedProduct ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              محصول عادی (بدون لایسنس)
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isGuestAttempt}
                onChange={(e) => setIsGuestAttempt(e.target.checked)}
              />
              <span>کاربر وارد حساب نشده (مهمان)</span>
            </label>
            {isGuestAttempt && hasLicensedProduct && (
              <label className="flex items-center gap-2 p-2.5 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createAccountAtCheckout}
                  onChange={(e) => setCreateAccountAtCheckout(e.target.checked)}
                />
                <span>ساخت حساب کاربری حین تسویه‌حساب (`woocommerce_checkout_registration_required`)</span>
              </label>
            )}
          </div>

          {hasLicensedProduct && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="نام"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="نام خانوادگی"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  dir="ltr"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="0912..."
                  className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
                <input
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@domain.ir"
                  className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <select
                value={selectedVariationId}
                onChange={(e) => setSelectedVariationId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              >
                {state.variations.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.variationLabel} — {toPersianDigits(v.bundlePriceToman.toLocaleString())} تومان
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
            >
              <option value="زرین‌پال (Zarinpal)">درگاه زرین‌پال</option>
              <option value="آیدی‌پی (IDPay)">درگاه آیدی‌پی</option>
              <option value="کارت‌به‌کارت تاییدشده">کارت‌به‌کارت</option>
            </select>
            <select
              value={orderStatus}
              onChange={(e) => setOrderStatus(e.target.value as OrderStatus)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg font-mono"
            >
              <option value="completed">completed</option>
              <option value="processing">processing</option>
              <option value="pending">pending</option>
            </select>
          </div>

          {checkoutMsg && (
            <div
              className={`p-3 rounded-lg text-xs border flex items-start gap-2 ${
                checkoutMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {checkoutMsg.type === 'err' ? (
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{checkoutMsg.text}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2.5 px-4 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900 transition-colors"
          >
            ثبت سفارش و تست شرط تسویه‌حساب
          </button>

          {/* Recent WooCommerce Orders & Issued Keys */}
          <div className="pt-3 border-t border-slate-100 space-y-2.5">
            <div className="text-xs font-semibold text-slate-800">سفارش‌های اخیر و تغییر وضعیت زنده:</div>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {state.orders.slice(0, 4).map((ord) => (
                <div key={ord.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 tabular-nums">
                      سفارش #{ord.id} · {ord.customerFirstName} {ord.customerLastName} ({ord.paymentMethod})
                    </span>
                    <select
                      value={ord.status}
                      onChange={(e) => onUpdateOrderStatus(ord.id, e.target.value as OrderStatus)}
                      className="px-2 py-0.5 text-[11px] font-mono border border-slate-300 rounded bg-white"
                    >
                      <option value="pending">pending</option>
                      <option value="processing">processing</option>
                      <option value="completed">completed</option>
                      <option value="refunded">refunded (لغو کلید)</option>
                    </select>
                  </div>
                  <div className="text-[11px] text-slate-500">{ord.variationLabel}</div>
                  {ord.issuedKeys.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {ord.issuedKeys.map((k) => (
                        <code key={k} className="text-[11px] font-mono bg-white px-1.5 py-0.5 border border-slate-200 rounded text-sky-900">
                          {k}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
