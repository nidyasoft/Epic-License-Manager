import crypto from 'node:crypto';
import { formatCalendarDate, formatRemainingTime } from '../shared/calendar.js';
import { buildPersianCsv, buildTrueXlsxBuffer } from './xlsx.js';
import type {
  ApiExchangeLog,
  CalendarSettings,
  CustomFieldGroup,
  DynamicFieldDefinition,
  ElmApp,
  ElmLicense,
  ElmTrialRecord,
  LicenseDuration,
  LicenseMode,
  OrderStatus,
  PromoConfig,
  SimulatorState,
  WooOrderRecord,
  WooProductVariation,
  WooSettings,
} from '../shared/types.js';

interface AppKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyHex: string;
  publicKeyBase64: string;
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function createEd25519Pair(seedHex?: string): AppKeyPair {
  let publicKey: crypto.KeyObject;
  let privateKey: crypto.KeyObject;

  if (seedHex && /^[0-9a-fA-F]{64}$/.test(seedHex.trim())) {
    const seedBuf = Buffer.from(seedHex.trim(), 'hex');
    const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, seedBuf]);
    privateKey = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    publicKey = crypto.createPublicKey(privateKey);
  } else {
    const generated = crypto.generateKeyPairSync('ed25519');
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
  }

  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rawDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = rawDer.subarray(-32);
  return {
    publicKeyPem: pubPem,
    privateKeyPem: privPem,
    publicKeyHex: rawPub.toString('hex'),
    publicKeyBase64: rawPub.toString('base64'),
  };
}

function hexToPublicPem(hex: string): string | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex.trim())) return null;
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex.trim(), 'hex')]);
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' }).toString();
}

function generateLicenseKey(prefix = 'ELM'): string {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${seg()}-${seg()}-${seg()}-${seg()}`;
}

function addDaysIso(baseDate: Date, days: number): string {
  return new Date(baseDate.getTime() + days * 86_400_000).toISOString();
}

function durationToDays(duration: LicenseDuration): number | null {
  switch (duration) {
    case '1m':
      return 30;
    case '3m':
      return 90;
    case '1y':
      return 365;
    case 'lifetime':
      return null;
  }
}

export function buildPromoHtmlFromVisual(
  promo: Pick<PromoConfig, 'headline' | 'subheadline' | 'discountBadge' | 'themeColor'>,
  variations: WooProductVariation[]
): string {
  const cardsHtml = variations
    .map((v) => {
      const pct =
        v.regularPriceToman > v.bundlePriceToman
          ? Math.round(((v.regularPriceToman - v.bundlePriceToman) / v.regularPriceToman) * 100)
          : 0;
      return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#f8fafc;">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
    <strong style="font-size:13px;color:#0f172a;">${v.variationLabel}</strong>
    ${pct > 0 ? `<span style="background:${promo.themeColor};color:#fff;font-size:11px;padding:2px 8px;border-radius:6px;">${pct}% تخفیف</span>` : ''}
  </div>
  <div style="margin-top:6px;font-size:12px;color:#475569;">
    <span style="font-weight:700;color:${promo.themeColor};">${v.bundlePriceToman.toLocaleString('fa-IR')} تومان</span>
    ${v.regularPriceToman > v.bundlePriceToman ? `<span style="text-decoration:line-through;color:#94a3b8;margin-right:8px;">${v.regularPriceToman.toLocaleString('fa-IR')} تومان</span>` : ''}
  </div>
</div>`;
    })
    .join('\n');

  return `<div style="font-family:Vazirmatn,Tahoma,sans-serif;direction:rtl;text-align:right;">
  <div style="display:inline-block;background:${promo.themeColor}15;color:${promo.themeColor};font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;margin-bottom:8px;">${promo.discountBadge}</div>
  <h3 style="margin:0 0 6px 0;font-size:16px;color:#0f172a;">${promo.headline}</h3>
  <p style="margin:0 0 12px 0;font-size:13px;line-height:1.7;color:#475569;">${promo.subheadline}</p>
  ${cardsHtml}
</div>`;
}

export class LicenseSimulatorStore {
  private state!: SimulatorState;
  private keypairs = new Map<string, AppKeyPair>();

  constructor() {
    this.reset();
  }

  public reset(): SimulatorState {
    this.keypairs.clear();
    const now = new Date();

    const app1Keys = createEd25519Pair();
    const app2Keys = createEd25519Pair();
    this.keypairs.set('yektap-crm-mobile', app1Keys);
    this.keypairs.set('atlas-pos-web', app2Keys);

    const apps: ElmApp[] = [
      {
        id: 'app_1',
        slug: 'yektap-crm-mobile',
        name: 'یکتاپ حسابدار اندروید (Yektap CRM)',
        platform: 'android',
        mode: 'method2_trial',
        trialDays: 14,
        offlineGraceDays: 14,
        publicKeyPem: app1Keys.publicKeyPem,
        publicKeyHex: app1Keys.publicKeyHex,
        publicKeyBase64: app1Keys.publicKeyBase64,
        isActive: true,
        purchaseUrl: 'https://yektap.ir/product/yektap-crm-license',
        gatedFeatures: ['صدور فاکتور رسمی PDF', 'گزارش مالیات و سود زیان', 'خروجی اکسل انبار'],
        createdAt: addDaysIso(now, -45),
      },
      {
        id: 'app_2',
        slug: 'atlas-pos-web',
        name: 'پنل تحت وب اطلس (Atlas POS Web)',
        platform: 'web',
        mode: 'method1_gated',
        trialDays: 0,
        offlineGraceDays: 7,
        publicKeyPem: app2Keys.publicKeyPem,
        publicKeyHex: app2Keys.publicKeyHex,
        publicKeyBase64: app2Keys.publicKeyBase64,
        isActive: true,
        purchaseUrl: 'https://yektap.ir/product/atlas-pos-subscription',
        gatedFeatures: ['اتصال چندشعبه‌ای', 'داشبورد تحلیلی لحظه‌ای', 'پشتیبان‌گیری ابری'],
        createdAt: addDaysIso(now, -30),
      },
    ];

    const variations: WooProductVariation[] = [
      {
        id: 'var_1m_1',
        productName: 'اشتراک یکتاپ حسابدار',
        variationLabel: 'اشتراک ۱ ماهه — ۱ لایسنس (تک‌کاربره)',
        appSlug: 'yektap-crm-mobile',
        duration: '1m',
        licenseQuantity: 1,
        regularPriceToman: 100000,
        bundlePriceToman: 100000,
      },
      {
        id: 'var_1m_2',
        productName: 'اشتراک یکتاپ حسابدار',
        variationLabel: 'بسته اقتصادی ۱ ماهه — ۲ لایسنس (۳۵٪ تخفیف پکیج)',
        appSlug: 'yektap-crm-mobile',
        duration: '1m',
        licenseQuantity: 2,
        regularPriceToman: 200000,
        bundlePriceToman: 130000,
      },
      {
        id: 'var_3m_5',
        productName: 'اشتراک یکتاپ حسابدار',
        variationLabel: 'بسته سازمانی ۳ ماهه — ۵ لایسنس همزمان',
        appSlug: 'yektap-crm-mobile',
        duration: '3m',
        licenseQuantity: 5,
        regularPriceToman: 1250000,
        bundlePriceToman: 780000,
      },
      {
        id: 'var_1y_1',
        productName: 'اشتراک یکتاپ حسابدار',
        variationLabel: 'اشتراک ۱ ساله — ۱ لایسنس طلایی',
        appSlug: 'yektap-crm-mobile',
        duration: '1y',
        licenseQuantity: 1,
        regularPriceToman: 980000,
        bundlePriceToman: 890000,
      },
      {
        id: 'var_life_1',
        productName: 'اشتراک پنل وب اطلس',
        variationLabel: 'لایسنس همیشگی (Lifetime) — ۳ لایسنس',
        appSlug: 'atlas-pos-web',
        duration: 'lifetime',
        licenseQuantity: 3,
        regularPriceToman: 4500000,
        bundlePriceToman: 3200000,
      },
    ];

    const licenses: ElmLicense[] = [
      {
        id: 'lic_1',
        licenseKey: 'ELM-9F4A-22C1-88B0-3E19',
        appSlug: 'yektap-crm-mobile',
        appName: 'یکتاپ حسابدار اندروید (Yektap CRM)',
        orderId: 4081,
        orderStatus: 'completed',
        orderTotalToman: 130000,
        paymentMethod: 'زرین‌پال (Zarinpal)',
        variationLabel: 'بسته اقتصادی ۱ ماهه — ۲ لایسنس (۳۵٪ تخفیف پکیج)',
        duration: '1m',
        status: 'active',
        customerId: 101,
        customerFirstName: 'مهرداد',
        customerLastName: 'رضایی',
        customerMobile: '09123456789',
        customerEmail: 'mehrdad.rezaei@example.ir',
        hardwareHash: 'android-8f3c91a4d2e07b11',
        deviceModel: 'Samsung Galaxy S24',
        osVersion: 'Android 15',
        activatedAt: addDaysIso(now, -6),
        expiresAt: addDaysIso(now, 24),
        createdAt: addDaysIso(now, -6),
        lastSyncAt: addDaysIso(now, -1),
        reinstallAttempts: 1,
        trialStatus: 'converted',
        lastErrorCode: null,
        isTestSandbox: false,
        customerMeta: {
          wp_user_registered: addDaysIso(now, -120),
          wc_billing_city: 'تهران',
          wc_billing_company: 'پخش سراسری آریا',
          wc_orders_count: 4,
          wc_total_spent_toman: 1420000,
          acf_national_id: '0018492031',
          acf_company_reg: 'IR-548201',
          acf_business_sector: 'پخش و عمده‌فروشی',
          acf_support_tier: 'VIP طلایی',
        },
      },
      {
        id: 'lic_2',
        licenseKey: 'ELM-9F4A-77D2-10E4-9A02',
        appSlug: 'yektap-crm-mobile',
        appName: 'یکتاپ حسابدار اندروید (Yektap CRM)',
        orderId: 4081,
        orderStatus: 'completed',
        orderTotalToman: 130000,
        paymentMethod: 'زرین‌پال (Zarinpal)',
        variationLabel: 'بسته اقتصادی ۱ ماهه — ۲ لایسنس (۳۵٪ تخفیف پکیج)',
        duration: '1m',
        status: 'active',
        customerId: 101,
        customerFirstName: 'مهرداد',
        customerLastName: 'رضایی',
        customerMobile: '09123456789',
        customerEmail: 'mehrdad.rezaei@example.ir',
        hardwareHash: null,
        deviceModel: null,
        osVersion: null,
        activatedAt: null,
        expiresAt: addDaysIso(now, 24),
        createdAt: addDaysIso(now, -6),
        lastSyncAt: null,
        reinstallAttempts: 0,
        trialStatus: 'none',
        lastErrorCode: null,
        isTestSandbox: false,
        customerMeta: {
          wp_user_registered: addDaysIso(now, -120),
          wc_billing_city: 'تهران',
          wc_billing_company: 'پخش سراسری آریا',
          wc_orders_count: 4,
          wc_total_spent_toman: 1420000,
          acf_national_id: '0018492031',
          acf_company_reg: 'IR-548201',
          acf_business_sector: 'پخش و عمده‌فروشی',
          acf_support_tier: 'VIP طلایی',
        },
      },
      {
        id: 'lic_3',
        licenseKey: 'ELM-3B11-C402-55A8-F901',
        appSlug: 'atlas-pos-web',
        appName: 'پنل تحت وب اطلس (Atlas POS Web)',
        orderId: 4089,
        orderStatus: 'completed',
        orderTotalToman: 3200000,
        paymentMethod: 'آیدی‌پی (IDPay)',
        variationLabel: 'لایسنس همیشگی (Lifetime) — ۳ لایسنس',
        duration: 'lifetime',
        status: 'active',
        customerId: 102,
        customerFirstName: 'سارا',
        customerLastName: 'محمدی',
        customerMobile: '09171112233',
        customerEmail: 'sara.mohammadi@example.ir',
        hardwareHash: 'web-browser-991a04bc',
        deviceModel: 'Chrome 131 / Windows 11',
        osVersion: 'Windows 11',
        activatedAt: addDaysIso(now, -15),
        expiresAt: null,
        createdAt: addDaysIso(now, -15),
        lastSyncAt: addDaysIso(now, -2),
        reinstallAttempts: 0,
        trialStatus: 'none',
        lastErrorCode: null,
        isTestSandbox: false,
        customerMeta: {
          wp_user_registered: addDaysIso(now, -210),
          wc_billing_city: 'شیراز',
          wc_billing_company: 'فروشگاه زنجیره‌ای پارس',
          wc_orders_count: 2,
          wc_total_spent_toman: 3450000,
          acf_national_id: '2291048572',
          acf_company_reg: 'IR-883920',
          acf_business_sector: 'فروشگاه زنجیره‌ای',
          acf_support_tier: 'سازمانی',
        },
      },
      {
        id: 'lic_4',
        licenseKey: 'ELM-112C-80AA-4E31-09BC',
        appSlug: 'yektap-crm-mobile',
        appName: 'یکتاپ حسابدار اندروید (Yektap CRM)',
        orderId: 4092,
        orderStatus: 'processing',
        orderTotalToman: 890000,
        paymentMethod: 'کارت‌به‌کارت تاییدشده',
        variationLabel: 'اشتراک ۱ ساله — ۱ لایسنس طلایی',
        duration: '1y',
        status: 'expired',
        customerId: 103,
        customerFirstName: 'امیرحسین',
        customerLastName: 'کریمی',
        customerMobile: '09358887766',
        customerEmail: 'amir.karimi@example.ir',
        hardwareHash: 'android-51cc92aa0019f4e2',
        deviceModel: 'Xiaomi 13 Pro',
        osVersion: 'Android 14',
        activatedAt: addDaysIso(now, -370),
        expiresAt: addDaysIso(now, -5),
        createdAt: addDaysIso(now, -370),
        lastSyncAt: addDaysIso(now, -20),
        reinstallAttempts: 2,
        trialStatus: 'expired',
        lastErrorCode: 'license_expired',
        isTestSandbox: false,
        customerMeta: {
          wp_user_registered: addDaysIso(now, -400),
          wc_billing_city: 'اصفهان',
          wc_billing_company: 'بازرگانی نقش جهان',
          wc_orders_count: 1,
          wc_total_spent_toman: 890000,
          acf_national_id: '1284920193',
          acf_company_reg: 'IR-190432',
          acf_business_sector: 'خدمات فنی و مهندسی',
          acf_support_tier: 'استاندارد',
        },
      },
    ];

    const orders: WooOrderRecord[] = [
      {
        id: 4081,
        status: 'completed',
        isGuestOrder: false,
        hasLicensedProduct: true,
        paymentMethod: 'زرین‌پال (Zarinpal)',
        customerFirstName: 'مهرداد',
        customerLastName: 'رضایی',
        customerMobile: '09123456789',
        customerEmail: 'mehrdad.rezaei@example.ir',
        variationId: 'var_1m_2',
        variationLabel: 'بسته اقتصادی ۱ ماهه — ۲ لایسنس (۳۵٪ تخفیف پکیج)',
        quantityOrdered: 1,
        totalToman: 130000,
        issuedKeys: ['ELM-9F4A-22C1-88B0-3E19', 'ELM-9F4A-77D2-10E4-9A02'],
        createdAt: addDaysIso(now, -6),
      },
      {
        id: 4089,
        status: 'completed',
        isGuestOrder: false,
        hasLicensedProduct: true,
        paymentMethod: 'آیدی‌پی (IDPay)',
        customerFirstName: 'سارا',
        customerLastName: 'محمدی',
        customerMobile: '09171112233',
        customerEmail: 'sara.mohammadi@example.ir',
        variationId: 'var_life_1',
        variationLabel: 'لایسنس همیشگی (Lifetime) — ۳ لایسنس',
        quantityOrdered: 1,
        totalToman: 3200000,
        issuedKeys: ['ELM-3B11-C402-55A8-F901'],
        createdAt: addDaysIso(now, -15),
      },
    ];

    const trials: ElmTrialRecord[] = [
      {
        id: 'tr_1',
        appSlug: 'yektap-crm-mobile',
        hardwareHash: 'android-8f3c91a4d2e07b11',
        deviceModel: 'Samsung Galaxy S24',
        osVersion: 'Android 15',
        startedAt: addDaysIso(now, -20),
        expiresAt: addDaysIso(now, -6),
        installCount: 2,
        blockedReinstallAttempts: 1,
        lastSeenAt: addDaysIso(now, -6),
        lastErrorCode: 'trial_already_used_and_expired',
        isTestSandbox: false,
      },
    ];

    const availableExtraFields: DynamicFieldDefinition[] = [
      { key: 'wc_billing_city', source: 'woocommerce', labelFa: 'شهر صورتحساب', labelEn: 'Billing City' },
      { key: 'wc_billing_company', source: 'woocommerce', labelFa: 'نام شرکت / فروشگاه', labelEn: 'Company' },
      { key: 'wc_orders_count', source: 'woocommerce', labelFa: 'تعداد کل سفارش‌ها', labelEn: 'Orders Count' },
      { key: 'wc_total_spent_toman', source: 'woocommerce', labelFa: 'مجموع خرید (تومان)', labelEn: 'Total Spent' },
      { key: 'wp_user_registered', source: 'wordpress', labelFa: 'تاریخ عضویت کاربر', labelEn: 'User Registered' },
      { key: 'acf_national_id', source: 'acf', labelFa: 'کد ملی (ACF)', labelEn: 'National ID (ACF)', acfGroup: 'مشخصات تکمیلی مشتری' },
      { key: 'acf_company_reg', source: 'acf', labelFa: 'شناسه ثبت شرکت (ACF)', labelEn: 'Company Reg (ACF)', acfGroup: 'مشخصات تکمیلی مشتری' },
      { key: 'acf_business_sector', source: 'acf', labelFa: 'صنف فعالیت (ACF)', labelEn: 'Business Sector (ACF)', acfGroup: 'مشخصات تکمیلی مشتری' },
      { key: 'acf_support_tier', source: 'acf', labelFa: 'سطح پشتیبانی (ACF)', labelEn: 'Support Tier (ACF)', acfGroup: 'مشخصات تکمیلی مشتری' },
    ];

    const calendar: CalendarSettings = {
      publicCalendar: 'jalali',
      adminCalendar: 'gregorian',
      pluginCalendar: 'jalali',
    };

    const woocommerce: WooSettings = {
      storeDomain: 'yektap.ir',
      triggerStatuses: ['completed', 'processing'],
      conditionalCartRegistration: true,
      sodiumAvailable: true,
      autoMuPatchInstalled: true,
    };

    const promo1Base = {
      id: 'promo_yektap',
      slug: 'yektap-special-offer',
      title: 'پیشنهاد ارتقای یکتاپ حسابدار',
      appSlug: 'yektap-crm-mobile',
      enabled: true,
      displayMode: 'floating_modal' as const,
      intervalSeconds: 180,
      showOnLockedClick: true,
      themeColor: '#0f4c81',
      headline: '۲ لایسنس یک‌ماهه با ۳۵٪ تخفیف بسته',
      subheadline: 'به‌جای خرید تکی برای هر دستگاه، بسته تیمی را با تحویل آنی لایسنس و پشتیبانی ۱۴ روزه آفلاین تهیه کنید.',
      discountBadge: 'پیشنهاد ویژه ارتقا · ۳۵٪ تخفیف',
      ctaLabel: 'خرید اشتراک و دریافت آنی لایسنس',
      ctaUrl: 'https://yektap.ir/product/yektap-crm-license',
      selectedVariationIds: ['var_1m_2', 'var_3m_5'],
      permalinkPath: '/elm-promo/yektap-special-offer',
    };

    const promos: PromoConfig[] = [
      {
        ...promo1Base,
        htmlContent: buildPromoHtmlFromVisual(
          promo1Base,
          variations.filter((v) => promo1Base.selectedVariationIds.includes(v.id))
        ),
      },
    ];

    const customFieldGroups: CustomFieldGroup[] = [
      {
        id: 'fg_product_specs',
        title: 'مشخصات فنی لایسنس محصول ووکامرس',
        slug: 'license-product-specs',
        targets: ['wc_product', 'wc_variation'],
        autoInjectFrontend: true,
        injectHook: 'wc_single_product_summary',
        active: true,
        conditions: [
          { id: 'c_1', param: 'wc_product_type', operator: 'equals', value: 'variable' },
        ],
        fields: [
          {
            id: 'f_1',
            name: 'elm_max_devices',
            label: 'حداکثر دستگاه مجاز',
            type: 'number',
            required: true,
            defaultValue: '2',
            choices: [],
            showInReport: true,
          },
          {
            id: 'f_2',
            name: 'elm_support_sla',
            label: 'سطح پشتیبانی فنی',
            type: 'select',
            required: false,
            defaultValue: 'پشتیبانی تلفنی + تیکت ۲ ساعته',
            choices: ['تیکت استاندارد', 'پشتیبانی تلفنی + تیکت ۲ ساعته', 'مدیر اختصاصی سازمانی'],
            showInReport: true,
          },
          {
            id: 'f_3',
            name: 'elm_release_date',
            label: 'تاریخ انتشار نسخه',
            type: 'date_triple',
            required: false,
            defaultValue: '1405-09-01',
            choices: [],
            showInReport: false,
          },
          {
            id: 'f_4',
            name: 'elm_changelog_items',
            label: 'ویژگی‌های نسخه جدید (Repeater)',
            type: 'repeater',
            required: false,
            defaultValue: '',
            choices: [],
            subFields: [
              { name: 'title', label: 'عنوان قابلیت', type: 'text' },
              { name: 'doc_url', label: 'لینک راهنما', type: 'url' },
            ],
            showInReport: false,
          },
        ],
      },
      {
        id: 'fg_vip_customer',
        title: 'فیلدهای تایید هویت مشتری دارای لایسنس فعال',
        slug: 'vip-license-customer',
        targets: ['wp_user', 'wc_order'],
        autoInjectFrontend: true,
        injectHook: 'wc_account_dashboard',
        active: true,
        conditions: [
          { id: 'c_2', param: 'user_logged_in', operator: 'equals', value: 'true' },
          { id: 'c_3', param: 'has_active_license', operator: 'equals', value: 'true' },
        ],
        fields: [
          {
            id: 'f_5',
            name: 'elm_company_national_id',
            label: 'شناسه ملی / کد اقتصادی شرکت',
            type: 'text',
            required: false,
            defaultValue: '14009821345',
            choices: [],
            showInReport: true,
          },
          {
            id: 'f_6',
            name: 'elm_vip_priority',
            label: 'تایید فاکتور رسمی',
            type: 'true_false',
            required: false,
            defaultValue: 'true',
            choices: [],
            showInReport: true,
          },
        ],
      },
    ];

    this.state = {
      calendar,
      woocommerce,
      promos,
      apps,
      variations,
      orders,
      licenses,
      trials,
      customFieldGroups,
      availableExtraFields,
      apiLogs: [],
    };

    return this.getState();
  }

  public getState(): SimulatorState {
    return this.state;
  }

  public updateCalendar(calendar: CalendarSettings): CalendarSettings {
    this.state.calendar = calendar;
    return this.state.calendar;
  }

  public updateWooSettings(wc: Partial<WooSettings>): WooSettings {
    this.state.woocommerce = {
      ...this.state.woocommerce,
      ...wc,
    };
    return this.state.woocommerce;
  }

  public upsertPromo(input: Partial<PromoConfig> & { id?: string; autoBuildHtml?: boolean }): PromoConfig {
    const cleanSlug = (input.slug || `promo-${Date.now()}`)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');
    const existingIdx = this.state.promos.findIndex((p) => p.id === input.id || p.slug === cleanSlug);
    const base: PromoConfig =
      existingIdx >= 0
        ? { ...this.state.promos[existingIdx] }
        : {
            id: `promo_${Date.now()}`,
            slug: cleanSlug,
            title: input.title || 'آفر جدید موبایل',
            appSlug: input.appSlug || this.state.apps[0]?.slug || 'yektap-crm-mobile',
            enabled: true,
            displayMode: 'floating_modal',
            intervalSeconds: 180,
            showOnLockedClick: true,
            themeColor: '#0f4c81',
            headline: 'ارتقای نسخه حرفه‌ای با تخفیف ویژه',
            subheadline: 'دسترسی نامحدود به همه ماژول‌ها و دریافت آنی کلید لایسنس پس از خرید.',
            discountBadge: 'پیشنهاد محدود',
            ctaLabel: 'خرید اشتراک و دریافت آنی لایسنس',
            ctaUrl: `https://${this.state.woocommerce.storeDomain}/product/${input.appSlug || 'yektap-crm-mobile'}`,
            selectedVariationIds: [],
            htmlContent: '',
            permalinkPath: `/elm-promo/${cleanSlug}`,
          };

    const merged: PromoConfig = {
      ...base,
      ...input,
      slug: cleanSlug,
      permalinkPath: `/elm-promo/${cleanSlug}`,
    };

    if (input.autoBuildHtml || !merged.htmlContent.trim()) {
      const selectedVars = this.state.variations.filter((v) => merged.selectedVariationIds.includes(v.id));
      merged.htmlContent = buildPromoHtmlFromVisual(merged, selectedVars);
    }

    if (existingIdx >= 0) {
      this.state.promos[existingIdx] = merged;
    } else {
      this.state.promos.unshift(merged);
    }
    return merged;
  }

  public createOrImportApp(input: {
    slug: string;
    name: string;
    platform: 'android' | 'web' | 'cross_platform';
    mode: LicenseMode;
    trialDays: number;
    offlineGraceDays: number;
    purchaseUrl: string;
    gatedFeatures: string[];
    customSeedHex?: string;
  }): ElmApp {
    const cleanSlug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const existing = this.state.apps.find((a) => a.slug === cleanSlug);
    if (existing) {
      return this.updateApp(existing.id, input) ?? existing;
    }

    const keys = createEd25519Pair(input.customSeedHex);
    this.keypairs.set(cleanSlug, keys);
    const created: ElmApp = {
      id: `app_${Date.now()}`,
      slug: cleanSlug,
      name: input.name,
      platform: input.platform,
      mode: input.mode,
      trialDays: Math.max(0, input.trialDays),
      offlineGraceDays: Math.max(1, input.offlineGraceDays),
      publicKeyPem: keys.publicKeyPem,
      publicKeyHex: keys.publicKeyHex,
      publicKeyBase64: keys.publicKeyBase64,
      isActive: true,
      purchaseUrl: input.purchaseUrl || `https://${this.state.woocommerce.storeDomain}/product/${cleanSlug}`,
      gatedFeatures: input.gatedFeatures.length ? input.gatedFeatures : ['امکانات پیشرفته نسخه حرفه‌ای'],
      createdAt: new Date().toISOString(),
    };
    this.state.apps.unshift(created);
    return created;
  }

  public updateApp(
    appId: string,
    patch: Partial<{
      name: string;
      platform: 'android' | 'web' | 'cross_platform';
      mode: LicenseMode;
      trialDays: number;
      offlineGraceDays: number;
      purchaseUrl: string;
      gatedFeatures: string[];
      isActive: boolean;
      regenerateKeys: boolean;
      customSeedHex: string;
      publicKeyHexOverride: string;
    }>
  ): ElmApp | null {
    const app = this.state.apps.find((a) => a.id === appId || a.slug === appId);
    if (!app) return null;

    if (typeof patch.name === 'string' && patch.name.trim()) app.name = patch.name.trim();
    if (patch.platform) app.platform = patch.platform;
    if (patch.mode) app.mode = patch.mode;
    if (typeof patch.trialDays === 'number') app.trialDays = Math.max(0, patch.trialDays);
    if (typeof patch.offlineGraceDays === 'number') app.offlineGraceDays = Math.max(1, patch.offlineGraceDays);
    if (typeof patch.purchaseUrl === 'string' && patch.purchaseUrl.trim()) app.purchaseUrl = patch.purchaseUrl.trim();
    if (Array.isArray(patch.gatedFeatures)) app.gatedFeatures = patch.gatedFeatures;
    if (typeof patch.isActive === 'boolean') app.isActive = patch.isActive;

    if (patch.regenerateKeys || (patch.customSeedHex && /^[0-9a-fA-F]{64}$/.test(patch.customSeedHex.trim()))) {
      const keys = createEd25519Pair(patch.customSeedHex);
      this.keypairs.set(app.slug, keys);
      app.publicKeyPem = keys.publicKeyPem;
      app.publicKeyHex = keys.publicKeyHex;
      app.publicKeyBase64 = keys.publicKeyBase64;
    } else if (patch.publicKeyHexOverride && /^[0-9a-fA-F]{64}$/.test(patch.publicKeyHexOverride.trim())) {
      const hex = patch.publicKeyHexOverride.trim().toLowerCase();
      const pem = hexToPublicPem(hex);
      if (pem) {
        app.publicKeyHex = hex;
        app.publicKeyBase64 = Buffer.from(hex, 'hex').toString('base64');
        app.publicKeyPem = pem;
      }
    }

    return app;
  }

  public testAppSignature(appId: string, note?: string): {
    ok: boolean;
    appSlug: string;
    publicKeyHex: string;
    publicKeyBase64: string;
    token: string;
    payload: Record<string, unknown>;
    verifiedWithAppHex: boolean;
    mismatchDetected: boolean;
    diagnosticMessage: string;
  } | null {
    const app = this.state.apps.find((a) => a.id === appId || a.slug === appId);
    if (!app) return null;

    const payload = {
      type: 'diagnostic_test',
      app_slug: app.slug,
      note: note || 'Live Ed25519 signature verification check',
      server_time_utc: new Date().toISOString(),
    };
    const token = this.signPayload(app.slug, payload);
    const parts = token.split('.');
    const pem = hexToPublicPem(app.publicKeyHex);
    let verifiedWithAppHex = false;
    if (pem && parts.length === 2) {
      try {
        verifiedWithAppHex = crypto.verify(
          null,
          Buffer.from(parts[0], 'utf8'),
          pem,
          Buffer.from(parts[1], 'base64url')
        );
      } catch {
        verifiedWithAppHex = false;
      }
    }

    return {
      ok: true,
      appSlug: app.slug,
      publicKeyHex: app.publicKeyHex,
      publicKeyBase64: app.publicKeyBase64,
      token,
      payload,
      verifiedWithAppHex,
      mismatchDetected: !verifiedWithAppHex,
      diagnosticMessage: verifiedWithAppHex
        ? 'کلید خصوصی سرور و کلید عمومی ۶۴ کاراکتری Hex کاملاً هم‌خوان هستند و توکن با موفقیت امضا و تایید شد.'
        : 'هشدار عدم تطابق کلید: کلید عمومی ذخیره‌شده با کلید خصوصی امضاکننده هم‌خوانی ندارد! از دکمه «تولید جفت کلید همسان» استفاده کنید.',
    };
  }

  public upsertVariation(input: Omit<WooProductVariation, 'id'> & { id?: string }): WooProductVariation {
    const qty = Math.max(1, Math.min(10, Math.round(input.licenseQuantity)));
    if (input.id) {
      const idx = this.state.variations.findIndex((v) => v.id === input.id);
      if (idx >= 0) {
        this.state.variations[idx] = { ...input, id: input.id, licenseQuantity: qty };
        return this.state.variations[idx];
      }
    }
    const created: WooProductVariation = {
      ...input,
      id: `var_${Date.now()}`,
      licenseQuantity: qty,
    };
    this.state.variations.push(created);
    return created;
  }

  public upsertCustomFieldGroup(input: CustomFieldGroup): CustomFieldGroup {
    const cleanSlug = (input.slug || input.title)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-') || `group-${Date.now()}`;
    const normalized: CustomFieldGroup = {
      ...input,
      id: input.id || `fg_${Date.now()}`,
      slug: cleanSlug,
    };
    const idx = this.state.customFieldGroups.findIndex((g) => g.id === normalized.id);
    if (idx >= 0) {
      this.state.customFieldGroups[idx] = normalized;
    } else {
      this.state.customFieldGroups.unshift(normalized);
    }
    return normalized;
  }

  public deleteCustomFieldGroup(id: string): boolean {
    const prev = this.state.customFieldGroups.length;
    this.state.customFieldGroups = this.state.customFieldGroups.filter((g) => g.id !== id);
    return this.state.customFieldGroups.length < prev;
  }

  public evaluateCustomFieldConditions(
    groupId: string,
    ctx: {
      target: string;
      user_logged_in: boolean;
      user_role: string;
      page_id: string;
      url_pattern: string;
      wc_product_type: string;
      wc_variation_id: string;
      has_active_license: boolean;
      field_values: Record<string, string>;
    }
  ): {
    passed: boolean;
    targetMatched: boolean;
    ruleResults: Array<{ ruleId: string; param: string; expected: string; actual: string; passed: boolean }>;
  } {
    const group = this.state.customFieldGroups.find((g) => g.id === groupId);
    if (!group || !group.active) {
      return { passed: false, targetMatched: false, ruleResults: [] };
    }
    const targetMatched = group.targets.includes(ctx.target as CustomFieldGroup['targets'][number]);
    const ruleResults = group.conditions.map((rule) => {
      let actual = '';
      switch (rule.param) {
        case 'user_logged_in':
          actual = String(ctx.user_logged_in);
          break;
        case 'user_role':
          actual = ctx.user_role;
          break;
        case 'page_id':
          actual = ctx.page_id;
          break;
        case 'url_pattern':
          actual = ctx.url_pattern;
          break;
        case 'wc_product_type':
          actual = ctx.wc_product_type;
          break;
        case 'wc_variation_id':
          actual = ctx.wc_variation_id;
          break;
        case 'has_active_license':
          actual = String(ctx.has_active_license);
          break;
        case 'field_equals': {
          const [fk] = rule.value.split(':');
          actual = ctx.field_values[fk] ?? '';
          break;
        }
      }

      const targetVal = rule.param === 'field_equals' ? rule.value.split(':')[1] ?? '' : rule.value;
      let passed = false;
      if (rule.operator === 'equals') passed = actual.toLowerCase() === targetVal.toLowerCase();
      else if (rule.operator === 'not_equals') passed = actual.toLowerCase() !== targetVal.toLowerCase();
      else if (rule.operator === 'contains') passed = actual.toLowerCase().includes(targetVal.toLowerCase());

      return {
        ruleId: rule.id,
        param: rule.param,
        expected: `${rule.operator} "${rule.value}"`,
        actual,
        passed,
      };
    });

    const allPassed = targetMatched && ruleResults.every((r) => r.passed);
    return { passed: allPassed, targetMatched, ruleResults };
  }

  public checkoutOrder(input: {
    hasLicensedProduct?: boolean;
    isGuestAttempt?: boolean;
    createAccountAtCheckout?: boolean;
    paymentMethod?: string;
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    variationId: string;
    quantityOrdered: number;
    initialStatus: OrderStatus;
  }): { ok: boolean; error?: string; order?: WooOrderRecord; issuedLicenses?: ElmLicense[] } {
    const hasLicensed = input.hasLicensedProduct !== false;

    // Conditional Cart Registration: ONLY enforce account registration when cart contains a licensed product
    if (hasLicensed && this.state.woocommerce.conditionalCartRegistration && input.isGuestAttempt && !input.createAccountAtCheckout) {
      return {
        ok: false,
        error:
          'چون در سبد خرید محصول دارای لایسنس اپیک وجود دارد، مهمان باید هنگام تسویه‌حساب وارد شود یا گزینه ساخت حساب کاربری را فعال کند (سفارش‌های غیرلایسنسی کاملاً آزاد هستند).',
      };
    }

    if (hasLicensed && input.isGuestAttempt && input.createAccountAtCheckout) {
      if (
        !input.firstName.trim() ||
        !input.lastName.trim() ||
        input.mobile.replace(/\D/g, '').length < 10 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
      ) {
        return {
          ok: false,
          error: 'برای ایجاد حساب و ارسال کلید لایسنس، تکمیل نام، نام خانوادگی، موبایل و ایمیل معتبر الزامی است.',
        };
      }
    }

    if (!hasLicensed) {
      // Non-licensed standard WooCommerce product -> untouched guest checkout allowed!
      const orderId = (this.state.orders[0]?.id ?? 4100) + 1;
      const order: WooOrderRecord = {
        id: orderId,
        status: input.initialStatus,
        isGuestOrder: Boolean(input.isGuestAttempt),
        hasLicensedProduct: false,
        paymentMethod: input.paymentMethod || 'زرین‌پال (Zarinpal)',
        customerFirstName: input.firstName.trim() || 'خریدار',
        customerLastName: input.lastName.trim() || 'مهمان',
        customerMobile: input.mobile.trim() || '—',
        customerEmail: input.email.trim() || 'guest@store.local',
        variationId: 'standard_non_licensed',
        variationLabel: 'محصول عادی ووکامرس (بدون نیاز به لایسنس)',
        quantityOrdered: 1,
        totalToman: 185000,
        issuedKeys: [],
        createdAt: new Date().toISOString(),
      };
      this.state.orders.unshift(order);
      return { ok: true, order, issuedLicenses: [] };
    }

    const variation = this.state.variations.find((v) => v.id === input.variationId);
    if (!variation) {
      return { ok: false, error: 'متغیر محصول انتخاب‌شده یافت نشد.' };
    }

    const orderId = (this.state.orders[0]?.id ?? 4100) + 1;
    const qtyUnits = Math.max(1, Math.min(10, input.quantityOrdered));
    const order: WooOrderRecord = {
      id: orderId,
      status: input.initialStatus,
      isGuestOrder: false,
      hasLicensedProduct: true,
      paymentMethod: input.paymentMethod || 'زرین‌پال (Zarinpal)',
      customerFirstName: input.firstName.trim(),
      customerLastName: input.lastName.trim(),
      customerMobile: input.mobile.trim(),
      customerEmail: input.email.trim(),
      variationId: variation.id,
      variationLabel: variation.variationLabel,
      quantityOrdered: qtyUnits,
      totalToman: variation.bundlePriceToman * qtyUnits,
      issuedKeys: [],
      createdAt: new Date().toISOString(),
    };

    this.state.orders.unshift(order);
    let issuedLicenses: ElmLicense[] = [];
    if (this.state.woocommerce.triggerStatuses.includes(order.status)) {
      issuedLicenses = this.issueKeysForOrder(order, variation);
    }

    return { ok: true, order, issuedLicenses };
  }

  public updateOrderStatus(orderId: number, status: OrderStatus): { order: WooOrderRecord; issuedLicenses: ElmLicense[] } | null {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) return null;
    order.status = status;

    let issuedLicenses: ElmLicense[] = [];
    if (order.hasLicensedProduct && this.state.woocommerce.triggerStatuses.includes(status) && order.issuedKeys.length === 0) {
      const variation = this.state.variations.find((v) => v.id === order.variationId);
      if (variation) {
        issuedLicenses = this.issueKeysForOrder(order, variation);
      }
    } else if (status === 'refunded' || status === 'cancelled') {
      for (const lic of this.state.licenses) {
        if (lic.orderId === order.id) {
          lic.status = 'revoked';
          lic.orderStatus = status;
        }
      }
    }
    return { order, issuedLicenses };
  }

  private issueKeysForOrder(order: WooOrderRecord, variation: WooProductVariation): ElmLicense[] {
    const app = this.state.apps.find((a) => a.slug === variation.appSlug);
    const totalKeys = variation.licenseQuantity * order.quantityOrdered;
    const created: ElmLicense[] = [];
    const now = new Date();
    const days = durationToDays(variation.duration);

    for (let i = 0; i < totalKeys; i++) {
      const key = generateLicenseKey('ELM');
      order.issuedKeys.push(key);
      const lic: ElmLicense = {
        id: `lic_${Date.now()}_${i}`,
        licenseKey: key,
        appSlug: variation.appSlug,
        appName: app?.name ?? variation.appSlug,
        orderId: order.id,
        orderStatus: order.status,
        orderTotalToman: order.totalToman,
        paymentMethod: order.paymentMethod,
        variationLabel: variation.variationLabel,
        duration: variation.duration,
        status: 'active',
        customerId: 200 + order.id,
        customerFirstName: order.customerFirstName,
        customerLastName: order.customerLastName,
        customerMobile: order.customerMobile,
        customerEmail: order.customerEmail,
        hardwareHash: null,
        deviceModel: null,
        osVersion: null,
        activatedAt: null,
        expiresAt: days === null ? null : addDaysIso(now, days),
        createdAt: now.toISOString(),
        lastSyncAt: null,
        reinstallAttempts: 0,
        trialStatus: 'none',
        lastErrorCode: null,
        isTestSandbox: false,
        customerMeta: {
          wp_user_registered: now.toISOString(),
          wc_billing_city: 'تهران',
          wc_billing_company: 'مشتری ثبت‌شده ووکامرس',
          wc_orders_count: 1,
          wc_total_spent_toman: order.totalToman,
          acf_national_id: '002' + String(1000000 + order.id).slice(-7),
          acf_company_reg: 'IR-' + String(400000 + order.id),
          acf_business_sector: 'کسب‌وکار دیجیتال',
          acf_support_tier: variation.licenseQuantity >= 2 ? 'بسته سازمانی' : 'استاندارد',
        },
      };
      this.state.licenses.unshift(lic);
      created.push(lic);
    }
    return created;
  }

  private signPayload(appSlug: string, payload: Record<string, unknown>): string {
    const pair = this.keypairs.get(appSlug) ?? Array.from(this.keypairs.values())[0];
    const json = JSON.stringify(payload);
    const payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
    const sig = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), pair.privateKeyPem).toString('base64url');
    return `${payloadB64}.${sig}`;
  }

  public verifySignedToken(
    appSlug: string,
    token: string,
    clientPublicKeyHexOverride?: string
  ): { valid: boolean; keyMismatch?: boolean; payload: Record<string, unknown> | null } {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, payload: null };
    const [payloadB64, sigB64] = parts;
    const app = this.state.apps.find((a) => a.slug === appSlug);
    const pair = this.keypairs.get(appSlug);
    if (!app || !pair) return { valid: false, payload: null };
    try {
      const hexToUse = clientPublicKeyHexOverride || app.publicKeyHex;
      const pubPem = hexToPublicPem(hexToUse) ?? pair.publicKeyPem;
      const ok = crypto.verify(
        null,
        Buffer.from(payloadB64, 'utf8'),
        pubPem,
        Buffer.from(sigB64, 'base64url')
      );
      const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>;
      return { valid: ok, keyMismatch: !ok && hexToUse !== pair.publicKeyHex, payload: parsed };
    } catch {
      return { valid: false, payload: null };
    }
  }

  private pushLog(
    endpoint: string,
    method: string,
    status: number,
    requestBody: Record<string, unknown> | null,
    responseBody: Record<string, unknown>
  ): void {
    this.state.apiLogs.unshift({
      id: `log_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      endpoint,
      method,
      status,
      requestBody,
      responseBody,
    });
    if (this.state.apiLogs.length > 25) {
      this.state.apiLogs.pop();
    }
  }

  public apiHandshake(appSlug: string, plainRoute = false): { status: number; data: Record<string, unknown> } {
    const app = this.state.apps.find((a) => a.slug === appSlug);
    const endpoint = plainRoute ? `/?rest_route=/elm/v1/app/handshake&app_slug=${appSlug}` : `/wp-json/elm/v1/app/handshake?app_slug=${appSlug}`;
    if (!app || !app.isActive) {
      const res = { ok: false, error: 'app_not_found_or_disabled' };
      this.pushLog(endpoint, 'GET', 404, null, res);
      return { status: 404, data: res };
    }
    const res = {
      ok: true,
      app_slug: app.slug,
      app_name: app.name,
      license_mode: app.mode,
      trial_days: app.trialDays,
      offline_grace_days: app.offlineGraceDays,
      public_key_hex: app.publicKeyHex,
      public_key_b64: app.publicKeyBase64,
      purchase_url: app.purchaseUrl,
      server_time_utc: new Date().toISOString(),
    };
    this.pushLog(endpoint, 'GET', 200, null, res);
    return { status: 200, data: res };
  }

  public apiActivateTrial(body: {
    app_slug: string;
    hardware_hash: string;
    device_model?: string;
    os_version?: string;
    plain_route?: boolean;
    is_test_sandbox?: boolean;
  }): { status: number; data: Record<string, unknown> } {
    const endpoint = body.plain_route ? '/?rest_route=/elm/v1/trial/activate' : '/wp-json/elm/v1/trial/activate';
    const app = this.state.apps.find((a) => a.slug === body.app_slug);
    if (!app || !app.isActive) {
      const res = { ok: false, error: 'app_not_found' };
      this.pushLog(endpoint, 'POST', 404, body, res);
      return { status: 404, data: res };
    }

    const now = new Date();
    const existing = this.state.trials.find(
      (t) => t.appSlug === app.slug && t.hardwareHash === body.hardware_hash
    );

    if (existing) {
      existing.lastSeenAt = now.toISOString();
      const expMs = new Date(existing.expiresAt).getTime();
      if (expMs <= now.getTime()) {
        existing.blockedReinstallAttempts += 1;
        existing.lastErrorCode = 'trial_already_used_and_expired';
        const res = {
          ok: false,
          error: 'trial_already_used_and_expired',
          message: 'دوره آزمایشی این دستگاه قبلا مصرف شده و منقضی است. حذف و نصب مجدد اپلیکیشن دوره Trial را تمدید نمی‌کند.',
          purchase_url: app.purchaseUrl,
          reinstall_attempts_blocked: existing.blockedReinstallAttempts,
        };
        this.pushLog(endpoint, 'POST', 403, body, res);
        return { status: 403, data: res };
      }
      existing.installCount += 1;
      const payload = {
        type: 'trial',
        app_slug: app.slug,
        hardware_hash: body.hardware_hash,
        issued_at_utc: existing.startedAt,
        expires_at_utc: existing.expiresAt,
        server_time_utc: now.toISOString(),
        offline_grace_days: app.offlineGraceDays,
      };
      const res = {
        ok: true,
        resumed_existing_trial: true,
        token: this.signPayload(app.slug, payload),
        public_key_hex: app.publicKeyHex,
        payload,
        purchase_url: app.purchaseUrl,
      };
      this.pushLog(endpoint, 'POST', 200, body, res);
      return { status: 200, data: res };
    }

    const days = Math.max(1, app.trialDays || 14);
    const expiresAt = addDaysIso(now, days);
    const trial: ElmTrialRecord = {
      id: `tr_${Date.now()}`,
      appSlug: app.slug,
      hardwareHash: body.hardware_hash,
      deviceModel: body.device_model || 'Android Device',
      osVersion: body.os_version || 'Android 15',
      startedAt: now.toISOString(),
      expiresAt,
      installCount: 1,
      blockedReinstallAttempts: 0,
      lastSeenAt: now.toISOString(),
      lastErrorCode: null,
      isTestSandbox: body.is_test_sandbox ?? true,
    };
    this.state.trials.unshift(trial);

    const payload = {
      type: 'trial',
      app_slug: app.slug,
      hardware_hash: body.hardware_hash,
      issued_at_utc: trial.startedAt,
      expires_at_utc: trial.expiresAt,
      server_time_utc: now.toISOString(),
      offline_grace_days: app.offlineGraceDays,
    };
    const res = {
      ok: true,
      message: `دوره آزمایشی رایگان ${days} روزه شما با موفقیت فعال شد.`,
      token: this.signPayload(app.slug, payload),
      public_key_hex: app.publicKeyHex,
      payload,
      purchase_url: app.purchaseUrl,
    };
    this.pushLog(endpoint, 'POST', 200, body, res);
    return { status: 200, data: res };
  }

  public apiExpireTrialForDemo(hardwareHash: string, appSlug: string): void {
    const tr = this.state.trials.find((t) => t.hardwareHash === hardwareHash && t.appSlug === appSlug);
    if (tr) {
      tr.expiresAt = addDaysIso(new Date(), -1);
      tr.lastErrorCode = 'trial_expired';
    }
  }

  public apiActivateLicense(body: {
    app_slug: string;
    license_key: string;
    hardware_hash: string;
    device_model?: string;
    os_version?: string;
    plain_route?: boolean;
  }): { status: number; data: Record<string, unknown> } {
    const endpoint = body.plain_route ? '/?rest_route=/elm/v1/license/activate' : '/wp-json/elm/v1/license/activate';
    const app = this.state.apps.find((a) => a.slug === body.app_slug);
    if (!app || !app.isActive) {
      const res = { ok: false, error: 'app_not_found' };
      this.pushLog(endpoint, 'POST', 404, body, res);
      return { status: 404, data: res };
    }
    const lic = this.state.licenses.find(
      (l) => l.licenseKey.toUpperCase() === body.license_key.trim().toUpperCase() && l.appSlug === app.slug
    );
    if (!lic || lic.status === 'revoked') {
      const res = { ok: false, error: 'invalid_or_revoked_license' };
      this.pushLog(endpoint, 'POST', 403, body, res);
      return { status: 403, data: res };
    }
    if (lic.expiresAt && new Date(lic.expiresAt).getTime() <= Date.now()) {
      lic.status = 'expired';
      lic.lastErrorCode = 'license_expired';
      const res = { ok: false, error: 'license_expired', purchase_url: app.purchaseUrl };
      this.pushLog(endpoint, 'POST', 403, body, res);
      return { status: 403, data: res };
    }

    const now = new Date();
    lic.hardwareHash = body.hardware_hash;
    lic.deviceModel = body.device_model || 'Android Device';
    lic.osVersion = body.os_version || 'Android 15';
    lic.activatedAt = lic.activatedAt ?? now.toISOString();
    lic.lastSyncAt = now.toISOString();
    lic.lastErrorCode = null;
    if (lic.trialStatus === 'active') lic.trialStatus = 'converted';

    const payload = {
      type: 'license',
      license_key: lic.licenseKey,
      duration: lic.duration,
      app_slug: app.slug,
      hardware_hash: body.hardware_hash,
      device_model: lic.deviceModel,
      issued_at_utc: now.toISOString(),
      expires_at_utc: lic.expiresAt,
      server_time_utc: now.toISOString(),
      offline_grace_days: app.offlineGraceDays,
    };

    const res = {
      ok: true,
      token: this.signPayload(app.slug, payload),
      public_key_hex: app.publicKeyHex,
      payload,
    };
    this.pushLog(endpoint, 'POST', 200, body, res);
    return { status: 200, data: res };
  }

  public apiVerifyLicense(body: {
    app_slug: string;
    license_key: string;
    hardware_hash: string;
    plain_route?: boolean;
  }): { status: number; data: Record<string, unknown> } {
    const endpoint = body.plain_route ? '/?rest_route=/elm/v1/license/verify' : '/wp-json/elm/v1/license/verify';
    const app = this.state.apps.find((a) => a.slug === body.app_slug);
    const lic = app
      ? this.state.licenses.find(
          (l) => l.licenseKey.toUpperCase() === body.license_key.trim().toUpperCase() && l.appSlug === app.slug
        )
      : undefined;

    if (!app || !lic || lic.status !== 'active') {
      const res = { ok: false, error: 'license_inactive' };
      this.pushLog(endpoint, 'POST', 403, body, res);
      return { status: 403, data: res };
    }

    const now = new Date();
    if (lic.expiresAt && new Date(lic.expiresAt).getTime() <= now.getTime()) {
      lic.status = 'expired';
      lic.lastErrorCode = 'license_expired';
      const res = { ok: false, error: 'license_expired', purchase_url: app.purchaseUrl };
      this.pushLog(endpoint, 'POST', 403, body, res);
      return { status: 403, data: res };
    }

    lic.lastSyncAt = now.toISOString();
    const payload = {
      type: 'license',
      license_key: lic.licenseKey,
      duration: lic.duration,
      app_slug: app.slug,
      hardware_hash: body.hardware_hash,
      issued_at_utc: now.toISOString(),
      expires_at_utc: lic.expiresAt,
      server_time_utc: now.toISOString(),
      offline_grace_days: app.offlineGraceDays,
    };
    const res = {
      ok: true,
      token: this.signPayload(app.slug, payload),
      public_key_hex: app.publicKeyHex,
      payload,
    };
    this.pushLog(endpoint, 'POST', 200, body, res);
    return { status: 200, data: res };
  }

  public apiGetPromo(appSlug: string, plainRoute = false): { status: number; data: Record<string, unknown> } {
    const app = this.state.apps.find((a) => a.slug === appSlug) ?? this.state.apps[0];
    const promo = this.state.promos.find((p) => p.appSlug === app.slug) ?? this.state.promos[0];
    const endpoint = plainRoute ? `/?rest_route=/elm/v1/promo&app_slug=${app.slug}` : `/wp-json/elm/v1/promo?app_slug=${app.slug}`;

    const res = {
      ok: true,
      app_slug: app.slug,
      promo_enabled: promo?.enabled ?? false,
      display_mode: promo?.displayMode ?? 'floating_modal',
      interval_seconds: promo?.intervalSeconds ?? 180,
      show_on_locked_click: promo?.showOnLockedClick ?? true,
      cta_label: promo?.ctaLabel ?? 'خرید اشتراک',
      purchase_url: promo?.ctaUrl || app.purchaseUrl,
      promo_url: promo?.permalinkPath ?? '/elm-promo/yektap-special-offer',
      html: promo?.htmlContent ?? '',
    };
    this.pushLog(endpoint, 'GET', 200, null, res);
    return { status: 200, data: res };
  }

  public clearTestSandboxRecords(): { removedTrials: number; removedLicenses: number } {
    const prevTrials = this.state.trials.length;
    const prevLicenses = this.state.licenses.length;
    this.state.trials = this.state.trials.filter((t) => !t.isTestSandbox);
    this.state.licenses = this.state.licenses.filter((l) => !l.isTestSandbox);
    return {
      removedTrials: prevTrials - this.state.trials.length,
      removedLicenses: prevLicenses - this.state.licenses.length,
    };
  }

  public async buildExcelExport(
    format: 'xlsx' | 'csv',
    extraKeys: string[],
    lang: 'fa' | 'en',
    filters?: { appSlug?: string; status?: string; duration?: string }
  ): Promise<{
    content: Buffer | string;
    contentType: string;
    filename: string;
  }> {
    const cal = this.state.calendar.pluginCalendar;
    const baseHeaders =
      lang === 'fa'
        ? [
            'کلید لایسنس',
            'اپلیکیشن',
            'سفارش',
            'مبلغ سفارش (تومان)',
            'درگاه پرداخت',
            'بسته و مدت',
            'وضعیت',
            'مدت باقی‌مانده',
            'تاریخ فعال‌سازی',
            'تاریخ انقضا',
            'آخرین همگام‌سازی',
            'مدل دستگاه',
            'سیستم‌عامل',
            'شناسه سخت‌افزار',
            'تلاش نصب مجدد',
            'وضعیت Trial',
            'آخرین کد خطا',
            'نام مشتری',
            'موبایل',
            'ایمیل',
          ]
        : [
            'License Key',
            'Application',
            'Order ID',
            'Order Total',
            'Payment Method',
            'Variation / Duration',
            'Status',
            'Remaining',
            'Activated At',
            'Expires At',
            'Last Sync',
            'Device Model',
            'OS Version',
            'Hardware Hash',
            'Reinstall Attempts',
            'Trial Status',
            'Last Error',
            'Customer Name',
            'Mobile',
            'Email',
          ];

    const extraDefs = this.state.availableExtraFields.filter((f) => extraKeys.includes(f.key));
    const headers = [...baseHeaders, ...extraDefs.map((d) => (lang === 'fa' ? d.labelFa : d.labelEn))];

    const filtered = this.state.licenses.filter((lic) => {
      if (filters?.appSlug && filters.appSlug !== 'all' && lic.appSlug !== filters.appSlug) return false;
      if (filters?.status && filters.status !== 'all' && lic.status !== filters.status) return false;
      if (filters?.duration && filters.duration !== 'all' && lic.duration !== filters.duration) return false;
      return true;
    });

    const rows = filtered.map((lic) => {
      const base = [
        lic.licenseKey,
        lic.appName,
        `#${lic.orderId}`,
        String(lic.orderTotalToman),
        lic.paymentMethod,
        `${lic.variationLabel} (${lic.duration})`,
        lic.status === 'active' ? (lang === 'fa' ? 'فعال' : 'Active') : lic.status === 'expired' ? (lang === 'fa' ? 'منقضی' : 'Expired') : (lang === 'fa' ? 'لغوشده' : 'Revoked'),
        formatRemainingTime(lic.expiresAt, lang),
        lic.activatedAt ? formatCalendarDate(lic.activatedAt, cal, lang, false) : '—',
        lic.expiresAt ? formatCalendarDate(lic.expiresAt, cal, lang, false) : lang === 'fa' ? 'همیشگی' : 'Lifetime',
        lic.lastSyncAt ? formatCalendarDate(lic.lastSyncAt, cal, lang, true) : '—',
        lic.deviceModel ?? '—',
        lic.osVersion ?? '—',
        lic.hardwareHash ?? '—',
        String(lic.reinstallAttempts),
        lic.trialStatus,
        lic.lastErrorCode ?? '—',
        `${lic.customerFirstName} ${lic.customerLastName}`,
        lic.customerMobile,
        lic.customerEmail,
      ];
      const extras = extraDefs.map((d) => String(lic.customerMeta[d.key] ?? '—'));
      return [...base, ...extras];
    });

    const dateTag = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      return {
        content: buildPersianCsv(headers, rows),
        contentType: 'text/csv; charset=utf-8',
        filename: `epic-licenses-report-${dateTag}.csv`,
      };
    }

    const xlsxBuffer = await buildTrueXlsxBuffer(headers, rows, lang === 'fa', 'EpicLicenses');
    return {
      content: xlsxBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `epic-licenses-report-${dateTag}.xlsx`,
    };
  }
}

export const simulatorStore = new LicenseSimulatorStore();
