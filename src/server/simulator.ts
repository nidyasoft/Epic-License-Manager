import crypto from 'node:crypto';
import { formatCalendarDate, formatRemainingTime } from '../shared/calendar.js';
import type {
  ApiExchangeLog,
  CalendarSettings,
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
}

function createEd25519Pair(): AppKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rawDer = publicKey.export({ type: 'spki', format: 'der' });
  const pubHex = rawDer.subarray(-32).toString('hex');
  return { publicKeyPem: pubPem, privateKeyPem: privPem, publicKeyHex: pubHex };
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
        activatedAt: addDaysIso(now, -6),
        expiresAt: addDaysIso(now, 24),
        createdAt: addDaysIso(now, -6),
        lastSyncAt: addDaysIso(now, -1),
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
        activatedAt: null,
        expiresAt: addDaysIso(now, 24),
        createdAt: addDaysIso(now, -6),
        lastSyncAt: null,
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
        activatedAt: addDaysIso(now, -15),
        expiresAt: null,
        createdAt: addDaysIso(now, -15),
        lastSyncAt: addDaysIso(now, -2),
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
        activatedAt: addDaysIso(now, -370),
        expiresAt: addDaysIso(now, -5),
        createdAt: addDaysIso(now, -370),
        lastSyncAt: addDaysIso(now, -20),
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
      blockGuestCheckout: true,
      requireFirstName: true,
      requireLastName: true,
      requireMobile: true,
      requireEmail: true,
    };

    const promo: PromoConfig = {
      enabled: true,
      displayMode: 'floating_modal',
      intervalSeconds: 180,
      showOnLockedClick: true,
      ctaLabel: 'خرید اشتراک و دریافت آنی لایسنس',
      ctaUrl: 'https://yektap.ir/product/yektap-crm-license',
      htmlContent: `<div style="font-family:Vazirmatn,sans-serif;direction:rtl;text-align:right;">
  <div style="font-size:12px;color:#0f4c81;font-weight:700;margin-bottom:6px;">پیشنهاد ویژه ارتقای نسخه حرفه‌ای</div>
  <h3 style="margin:0 0 8px 0;font-size:17px;color:#0f172a;">۲ لایسنس یک‌ماهه با ۳۵٪ تخفیف بسته</h3>
  <p style="margin:0 0 12px 0;font-size:13px;line-height:1.7;color:#475569;">به جای پرداخت ۲۰۰٬۰۰۰ تومان برای دو دستگاه، فقط <strong>۱۳۰٬۰۰۰ تومان</strong> بپردازید و بلافاصله پس از پرداخت هر دو کلید لایسنس را دریافت کنید.</p>
  <ul style="margin:0 0 14px 0;padding-right:18px;font-size:12px;color:#334155;">
    <li>صدور فاکتور رسمی PDF و گزارش مالیاتی</li>
    <li>کارکرد آفلاین تا ۱۴ روز بدون نیاز به اینترنت دائمی</li>
  </ul>
</div>`,
    };

    this.state = {
      calendar,
      woocommerce,
      promo,
      apps,
      variations,
      orders,
      licenses,
      trials,
      availableExtraFields,
      apiLogs: [],
      serverClockOffsetHours: 0,
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

  public updatePromo(promo: Partial<PromoConfig>): PromoConfig {
    this.state.promo = {
      ...this.state.promo,
      ...promo,
    };
    return this.state.promo;
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
  }): ElmApp {
    const cleanSlug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const existing = this.state.apps.find((a) => a.slug === cleanSlug);
    if (existing) {
      existing.name = input.name;
      existing.platform = input.platform;
      existing.mode = input.mode;
      existing.trialDays = input.trialDays;
      existing.offlineGraceDays = input.offlineGraceDays;
      existing.purchaseUrl = input.purchaseUrl;
      existing.gatedFeatures = input.gatedFeatures;
      return existing;
    }

    const keys = createEd25519Pair();
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
      purchaseUrl: input.purchaseUrl || `https://${this.state.woocommerce.storeDomain}/product/${cleanSlug}`,
      gatedFeatures: input.gatedFeatures.length ? input.gatedFeatures : ['امکانات پیشرفته نسخه حرفه‌ای'],
      createdAt: new Date().toISOString(),
    };
    this.state.apps.unshift(created);
    return created;
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

  public checkoutOrder(input: {
    isGuestAttempt?: boolean;
    firstName: string;
    lastName: string;
    mobile: string;
    email: string;
    variationId: string;
    quantityOrdered: number;
    initialStatus: OrderStatus;
  }): { ok: boolean; error?: string; order?: WooOrderRecord; issuedLicenses?: ElmLicense[] } {
    if (this.state.woocommerce.blockGuestCheckout && input.isGuestAttempt) {
      return {
        ok: false,
        error: 'پرداخت مهمان غیرفعال است. کاربر موظف است پیش از پرداخت با نام، نام خانوادگی، موبایل و ایمیل ثبت‌نام یا وارد حساب کاربری شود.',
      };
    }

    if (
      (this.state.woocommerce.requireFirstName && !input.firstName.trim()) ||
      (this.state.woocommerce.requireLastName && !input.lastName.trim()) ||
      (this.state.woocommerce.requireMobile && input.mobile.replace(/\D/g, '').length < 10) ||
      (this.state.woocommerce.requireEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
    ) {
      return {
        ok: false,
        error: 'تکمیل فیلدهای الزامی (نام، نام خانوادگی، شماره موبایل معتبر و ایمیل صحیح) پیش از انتقال به درگاه الزامی است.',
      };
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
    if (this.state.woocommerce.triggerStatuses.includes(status) && order.issuedKeys.length === 0) {
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
        activatedAt: null,
        expiresAt: days === null ? null : addDaysIso(now, days),
        createdAt: now.toISOString(),
        lastSyncAt: null,
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

  public verifySignedToken(appSlug: string, token: string): { valid: boolean; payload: Record<string, unknown> | null } {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, payload: null };
    const [payloadB64, sigB64] = parts;
    const pair = this.keypairs.get(appSlug);
    if (!pair) return { valid: false, payload: null };
    try {
      const ok = crypto.verify(
        null,
        Buffer.from(payloadB64, 'utf8'),
        pair.publicKeyPem,
        Buffer.from(sigB64, 'base64url')
      );
      const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>;
      return { valid: ok, payload: parsed };
    } catch {
      return { valid: false, payload: null };
    }
  }

  private pushLog(endpoint: string, method: string, status: number, requestBody: Record<string, unknown> | null, responseBody: Record<string, unknown>): void {
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

  public apiActivateTrial(body: {
    app_slug: string;
    hardware_hash: string;
    device_model?: string;
    os_version?: string;
  }): { status: number; data: Record<string, unknown> } {
    const app = this.state.apps.find((a) => a.slug === body.app_slug);
    if (!app) {
      const res = { ok: false, error: 'app_not_found' };
      this.pushLog('/wp-json/elm/v1/trial/activate', 'POST', 404, body, res);
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
        const res = {
          ok: false,
          error: 'trial_already_used_and_expired',
          message: 'دوره آزمایشی این دستگاه قبلا مصرف شده و منقضی است. حذف و نصب مجدد اپلیکیشن دوره Trial را تمدید نمی‌کند.',
          purchase_url: app.purchaseUrl,
          reinstall_attempts_blocked: existing.blockedReinstallAttempts,
        };
        this.pushLog('/wp-json/elm/v1/trial/activate', 'POST', 403, body, res);
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
        payload,
        purchase_url: app.purchaseUrl,
      };
      this.pushLog('/wp-json/elm/v1/trial/activate', 'POST', 200, body, res);
      return { status: 200, data: res };
    }

    const days = Math.max(1, app.trialDays || 14);
    const expiresAt = addDaysIso(now, days);
    const trial: ElmTrialRecord = {
      id: `tr_${Date.now()}`,
      appSlug: app.slug,
      hardwareHash: body.hardware_hash,
      deviceModel: body.device_model || 'Android Device',
      osVersion: body.os_version || 'Android 14',
      startedAt: now.toISOString(),
      expiresAt,
      installCount: 1,
      blockedReinstallAttempts: 0,
      lastSeenAt: now.toISOString(),
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
      payload,
      purchase_url: app.purchaseUrl,
    };
    this.pushLog('/wp-json/elm/v1/trial/activate', 'POST', 200, body, res);
    return { status: 200, data: res };
  }

  public apiExpireTrialForDemo(hardwareHash: string, appSlug: string): void {
    const tr = this.state.trials.find((t) => t.hardwareHash === hardwareHash && t.appSlug === appSlug);
    if (tr) {
      tr.expiresAt = addDaysIso(new Date(), -1);
    }
  }

  public apiActivateLicense(body: {
    app_slug: string;
    license_key: string;
    hardware_hash: string;
    device_model?: string;
  }): { status: number; data: Record<string, unknown> } {
    const app = this.state.apps.find((a) => a.slug === body.app_slug);
    if (!app) {
      const res = { ok: false, error: 'app_not_found' };
      this.pushLog('/wp-json/elm/v1/license/activate', 'POST', 404, body, res);
      return { status: 404, data: res };
    }
    const lic = this.state.licenses.find(
      (l) => l.licenseKey.toUpperCase() === body.license_key.trim().toUpperCase() && l.appSlug === app.slug
    );
    if (!lic || lic.status === 'revoked') {
      const res = { ok: false, error: 'invalid_or_revoked_license' };
      this.pushLog('/wp-json/elm/v1/license/activate', 'POST', 403, body, res);
      return { status: 403, data: res };
    }
    if (lic.expiresAt && new Date(lic.expiresAt).getTime() <= Date.now()) {
      lic.status = 'expired';
      const res = { ok: false, error: 'license_expired', purchase_url: app.purchaseUrl };
      this.pushLog('/wp-json/elm/v1/license/activate', 'POST', 403, body, res);
      return { status: 403, data: res };
    }

    const now = new Date();
    lic.hardwareHash = body.hardware_hash;
    lic.deviceModel = body.device_model || 'Android Device';
    lic.activatedAt = lic.activatedAt ?? now.toISOString();
    lic.lastSyncAt = now.toISOString();

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
      payload,
    };
    this.pushLog('/wp-json/elm/v1/license/activate', 'POST', 200, body, res);
    return { status: 200, data: res };
  }

  public apiVerifyLicense(body: {
    app_slug: string;
    license_key: string;
    hardware_hash: string;
  }): { status: number; data: Record<string, unknown> } {
    const app = this.state.apps.find((a) => a.slug === body.app_slug);
    const lic = app
      ? this.state.licenses.find(
          (l) => l.licenseKey.toUpperCase() === body.license_key.trim().toUpperCase() && l.appSlug === app.slug
        )
      : undefined;

    if (!app || !lic || lic.status !== 'active') {
      const res = { ok: false, error: 'license_inactive' };
      this.pushLog('/wp-json/elm/v1/license/verify', 'POST', 403, body, res);
      return { status: 403, data: res };
    }

    const now = new Date();
    if (lic.expiresAt && new Date(lic.expiresAt).getTime() <= now.getTime()) {
      lic.status = 'expired';
      const res = { ok: false, error: 'license_expired', purchase_url: app.purchaseUrl };
      this.pushLog('/wp-json/elm/v1/license/verify', 'POST', 403, body, res);
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
      payload,
    };
    this.pushLog('/wp-json/elm/v1/license/verify', 'POST', 200, body, res);
    return { status: 200, data: res };
  }

  public apiGetPromo(appSlug: string): { status: number; data: Record<string, unknown> } {
    const app = this.state.apps.find((a) => a.slug === appSlug) ?? this.state.apps[0];
    const res = {
      ok: true,
      app_slug: app.slug,
      promo_enabled: this.state.promo.enabled,
      display_mode: this.state.promo.displayMode,
      interval_seconds: this.state.promo.intervalSeconds,
      show_on_locked_click: this.state.promo.showOnLockedClick,
      cta_label: this.state.promo.ctaLabel,
      purchase_url: this.state.promo.ctaUrl || app.purchaseUrl,
      html: this.state.promo.htmlContent,
    };
    this.pushLog(`/wp-json/elm/v1/promo?app_slug=${app.slug}`, 'GET', 200, null, res);
    return { status: 200, data: res };
  }

  public buildExcelExport(format: 'xls' | 'csv', extraKeys: string[], lang: 'fa' | 'en'): {
    content: string;
    contentType: string;
    filename: string;
  } {
    const cal = this.state.calendar.pluginCalendar;
    const baseHeaders =
      lang === 'fa'
        ? ['کلید لایسنس', 'اپلیکیشن', 'شماره سفارش', 'وضعیت', 'مدت اعتبار', 'زمان باقی‌مانده', 'تاریخ انقضا', 'نام مشتری', 'موبایل', 'ایمیل']
        : ['License Key', 'Application', 'Order ID', 'Status', 'Duration', 'Remaining', 'Expires At', 'Customer Name', 'Mobile', 'Email'];

    const extraDefs = this.state.availableExtraFields.filter((f) => extraKeys.includes(f.key));
    const headers = [...baseHeaders, ...extraDefs.map((d) => (lang === 'fa' ? d.labelFa : d.labelEn))];

    const rows = this.state.licenses.map((lic) => {
      const base = [
        lic.licenseKey,
        lic.appName,
        String(lic.orderId),
        lic.status,
        lic.duration,
        formatRemainingTime(lic.expiresAt, lang),
        lic.expiresAt ? formatCalendarDate(lic.expiresAt, cal, lang, false) : lang === 'fa' ? 'همیشگی' : 'Lifetime',
        `${lic.customerFirstName} ${lic.customerLastName}`,
        lic.customerMobile,
        lic.customerEmail,
      ];
      const extras = extraDefs.map((d) => String(lic.customerMeta[d.key] ?? '—'));
      return [...base, ...extras];
    });

    if (format === 'csv') {
      const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
      const csvBody = [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n');
      return {
        content: '\uFEFF' + csvBody,
        contentType: 'text/csv; charset=utf-8',
        filename: `epic-licenses-report-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    }

    // Excel SpreadsheetML 2003 XML (opens natively in Microsoft Excel with full Persian UTF-8 + RTL support)
    const xmlEscape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const headerCells = headers
      .map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`)
      .join('');
    const dataRows = rows
      .map(
        (r) =>
          `<Row>${r
            .map((cell) => `<Cell><Data ss:Type="String">${xmlEscape(cell)}</Data></Cell>`)
            .join('')}</Row>`
      )
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="sHeader">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F4C81" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="EpicLicenses" ss:RightToLeft="${lang === 'fa' ? '1' : '0'}">
  <Table>
   <Row>${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;

    return {
      content: xml,
      contentType: 'application/vnd.ms-excel; charset=utf-8',
      filename: `epic-licenses-report-${new Date().toISOString().slice(0, 10)}.xls`,
    };
  }
}

export const simulatorStore = new LicenseSimulatorStore();
