export type CalendarType = 'gregorian' | 'jalali' | 'hijri';
export type LicenseMode = 'method1_gated' | 'method2_trial';
export type LicenseDuration = '1m' | '3m' | '1y' | 'lifetime';
export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'pending';
export type OrderStatus = 'pending' | 'on-hold' | 'processing' | 'completed' | 'cancelled' | 'refunded';

export interface CalendarSettings {
  publicCalendar: CalendarType;
  adminCalendar: CalendarType;
  pluginCalendar: CalendarType;
}

export interface WooSettings {
  storeDomain: string;
  triggerStatuses: OrderStatus[];
  blockGuestCheckout: boolean;
  requireFirstName: boolean;
  requireLastName: boolean;
  requireMobile: boolean;
  requireEmail: boolean;
}

export interface PromoConfig {
  enabled: boolean;
  displayMode: 'floating_modal' | 'inline_banner';
  intervalSeconds: number;
  showOnLockedClick: boolean;
  ctaLabel: string;
  ctaUrl: string;
  htmlContent: string;
}

export interface ElmApp {
  id: string;
  slug: string;
  name: string;
  platform: 'android' | 'web' | 'cross_platform';
  mode: LicenseMode;
  trialDays: number;
  offlineGraceDays: number;
  publicKeyPem: string;
  publicKeyHex: string;
  purchaseUrl: string;
  gatedFeatures: string[];
  createdAt: string;
}

export interface WooProductVariation {
  id: string;
  productName: string;
  variationLabel: string;
  appSlug: string;
  duration: LicenseDuration;
  licenseQuantity: number; // 1 to 10
  regularPriceToman: number;
  bundlePriceToman: number;
}

export interface CustomerExtraFields {
  wp_user_registered: string;
  wc_billing_city: string;
  wc_billing_company: string;
  wc_orders_count: number;
  wc_total_spent_toman: number;
  acf_national_id: string;
  acf_company_reg: string;
  acf_business_sector: string;
  acf_support_tier: string;
}

export interface DynamicFieldDefinition {
  key: keyof CustomerExtraFields;
  source: 'wordpress' | 'woocommerce' | 'acf';
  labelFa: string;
  labelEn: string;
  acfGroup?: string;
}

export interface ElmLicense {
  id: string;
  licenseKey: string;
  appSlug: string;
  appName: string;
  orderId: number;
  orderStatus: OrderStatus;
  variationLabel: string;
  duration: LicenseDuration;
  status: LicenseStatus;
  customerId: number;
  customerFirstName: string;
  customerLastName: string;
  customerMobile: string;
  customerEmail: string;
  hardwareHash: string | null;
  deviceModel: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  lastSyncAt: string | null;
  customerMeta: CustomerExtraFields;
}

export interface ElmTrialRecord {
  id: string;
  appSlug: string;
  hardwareHash: string;
  deviceModel: string;
  osVersion: string;
  startedAt: string;
  expiresAt: string;
  installCount: number;
  blockedReinstallAttempts: number;
  lastSeenAt: string;
}

export interface WooOrderRecord {
  id: number;
  status: OrderStatus;
  customerFirstName: string;
  customerLastName: string;
  customerMobile: string;
  customerEmail: string;
  variationId: string;
  variationLabel: string;
  quantityOrdered: number;
  totalToman: number;
  issuedKeys: string[];
  createdAt: string;
}

export interface ApiExchangeLog {
  id: string;
  timestamp: string;
  endpoint: string;
  method: string;
  status: number;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown>;
}

export interface PluginVirtualFile {
  path: string;
  language: 'php' | 'css' | 'js' | 'po' | 'md' | 'json';
  description: string;
  content: string;
}

export interface SimulatorState {
  calendar: CalendarSettings;
  woocommerce: WooSettings;
  promo: PromoConfig;
  apps: ElmApp[];
  variations: WooProductVariation[];
  orders: WooOrderRecord[];
  licenses: ElmLicense[];
  trials: ElmTrialRecord[];
  availableExtraFields: DynamicFieldDefinition[];
  apiLogs: ApiExchangeLog[];
  serverClockOffsetHours: number;
}
