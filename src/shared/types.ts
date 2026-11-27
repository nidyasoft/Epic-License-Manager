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
  conditionalCartRegistration: boolean;
  sodiumAvailable: boolean;
  autoMuPatchInstalled: boolean;
}

export interface PromoPlanItem {
  variationId: string;
  title: string;
  durationLabel: string;
  priceToman: number;
  regularPriceToman: number;
  highlightBadge?: string;
}

export interface PromoConfig {
  id: string;
  slug: string;
  title: string;
  appSlug: string;
  enabled: boolean;
  displayMode: 'floating_modal' | 'inline_banner';
  intervalSeconds: number;
  showOnLockedClick: boolean;
  themeColor: string;
  headline: string;
  subheadline: string;
  discountBadge: string;
  ctaLabel: string;
  ctaUrl: string;
  selectedVariationIds: string[];
  htmlContent: string;
  permalinkPath: string;
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
  publicKeyBase64: string;
  isActive: boolean;
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
  orderTotalToman: number;
  paymentMethod: string;
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
  osVersion: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  lastSyncAt: string | null;
  reinstallAttempts: number;
  trialStatus: 'none' | 'active' | 'expired' | 'converted';
  lastErrorCode: string | null;
  isTestSandbox?: boolean;
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
  lastErrorCode: string | null;
  isTestSandbox?: boolean;
}

export interface WooOrderRecord {
  id: number;
  status: OrderStatus;
  isGuestOrder: boolean;
  hasLicensedProduct: boolean;
  paymentMethod: string;
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

// ACF-style Custom Field Builder Types
export type CustomFieldTarget =
  | 'wc_product'
  | 'wc_variation'
  | 'wp_user'
  | 'wp_post'
  | 'wp_page'
  | 'wc_order';

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'url'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'true_false'
  | 'date_triple'
  | 'media'
  | 'repeater';

export type ConditionParam =
  | 'user_logged_in'
  | 'user_role'
  | 'page_id'
  | 'url_pattern'
  | 'wc_product_type'
  | 'wc_variation_id'
  | 'field_equals'
  | 'has_active_license';

export interface FieldConditionRule {
  id: string;
  param: ConditionParam;
  operator: 'equals' | 'not_equals' | 'contains';
  value: string;
}

export interface CustomFieldItem {
  id: string;
  name: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: string;
  choices: string[]; // for select / checkbox / radio
  subFields?: Array<{ name: string; label: string; type: 'text' | 'number' | 'url' }>; // for repeater
  showInReport: boolean;
}

export interface CustomFieldGroup {
  id: string;
  title: string;
  slug: string;
  targets: CustomFieldTarget[];
  autoInjectFrontend: boolean;
  injectHook:
    | 'the_content_after'
    | 'wc_single_product_summary'
    | 'wc_before_add_to_cart'
    | 'wc_account_dashboard';
  conditions: FieldConditionRule[];
  fields: CustomFieldItem[];
  active: boolean;
}

export interface SimulatorState {
  calendar: CalendarSettings;
  woocommerce: WooSettings;
  promos: PromoConfig[];
  apps: ElmApp[];
  variations: WooProductVariation[];
  orders: WooOrderRecord[];
  licenses: ElmLicense[];
  trials: ElmTrialRecord[];
  customFieldGroups: CustomFieldGroup[];
  availableExtraFields: DynamicFieldDefinition[];
  apiLogs: ApiExchangeLog[];
}
