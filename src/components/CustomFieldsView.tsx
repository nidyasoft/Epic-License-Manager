import React, { useState } from 'react';
import { Check, Code2, Copy, Layers, Plus, Play, Trash2 } from 'lucide-react';
import type {
  ConditionParam,
  CustomFieldGroup,
  CustomFieldItem,
  CustomFieldTarget,
  CustomFieldType,
  FieldConditionRule,
  SimulatorState,
} from '../shared/types.js';
import { fetchJson } from '../shared/http.js';

interface Props {
  state: SimulatorState;
  lang: 'fa' | 'en';
  onSaveGroup: (group: CustomFieldGroup) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
}

const TARGET_OPTIONS: Array<{ id: CustomFieldTarget; labelFa: string; labelEn: string }> = [
  { id: 'wc_product', labelFa: 'محصول ساده ووکامرس', labelEn: 'WC Simple Product' },
  { id: 'wc_variation', labelFa: 'متغیر محصول ووکامرس', labelEn: 'WC Product Variation' },
  { id: 'wp_user', labelFa: 'پروفایل کاربر / مشتری', labelEn: 'WP User / Customer' },
  { id: 'wp_post', labelFa: 'نوشته‌ها و پست‌تایپ‌ها', labelEn: 'WP Posts / CPT' },
  { id: 'wp_page', labelFa: 'برگه‌های وردپرس', labelEn: 'WP Pages' },
  { id: 'wc_order', labelFa: 'سفارش ووکامرس (HPOS)', labelEn: 'WC Order (HPOS)' },
];

const FIELD_TYPES: Array<{ id: CustomFieldType; labelFa: string; labelEn: string }> = [
  { id: 'text', labelFa: 'متن (Text)', labelEn: 'Text' },
  { id: 'number', labelFa: 'عدد (Number)', labelEn: 'Number' },
  { id: 'email', labelFa: 'ایمیل (Email)', labelEn: 'Email' },
  { id: 'url', labelFa: 'لینک (URL)', labelEn: 'URL' },
  { id: 'textarea', labelFa: 'ناحیه متنی (Textarea)', labelEn: 'Textarea' },
  { id: 'select', labelFa: 'لیست کشویی (Select)', labelEn: 'Select' },
  { id: 'checkbox', labelFa: 'چک‌باکس (Checkbox)', labelEn: 'Checkbox' },
  { id: 'radio', labelFa: 'دکمه رادیویی (Radio)', labelEn: 'Radio' },
  { id: 'true_false', labelFa: 'بله / خیر (True/False)', labelEn: 'True/False' },
  { id: 'date_triple', labelFa: 'تاریخ سه‌گانه (میلادی/شمسی/قمری)', labelEn: 'Triple Calendar Date' },
  { id: 'media', labelFa: 'آپلود تصویر / فایل رسانه', labelEn: 'Media Upload' },
  { id: 'repeater', labelFa: 'فیلد تکرارشونده (Repeater)', labelEn: 'Repeater' },
];

const CONDITION_PARAMS: Array<{ id: ConditionParam; labelFa: string; labelEn: string; hint: string }> = [
  { id: 'user_logged_in', labelFa: 'وضعیت ورود کاربر', labelEn: 'User Logged In', hint: 'true / false' },
  { id: 'user_role', labelFa: 'نقش کاربری وردپرس', labelEn: 'WP User Role', hint: 'customer / administrator' },
  { id: 'page_id', labelFa: 'شناسه برگه یا نوشته خاص', labelEn: 'Specific Page/Post ID', hint: '42' },
  { id: 'url_pattern', labelFa: 'الگوی آدرس URL', labelEn: 'URL Pattern', hint: '/product/' },
  { id: 'wc_product_type', labelFa: 'نوع محصول ووکامرس', labelEn: 'WC Product Type', hint: 'simple / variable' },
  { id: 'wc_variation_id', labelFa: 'شناسه متغیر محصول', labelEn: 'WC Variation ID', hint: 'var_1m_2' },
  { id: 'has_active_license', labelFa: 'داشتن لایسنس فعال اپیک', labelEn: 'Has Active Epic License', hint: 'true / false' },
  { id: 'field_equals', labelFa: 'مقدار فیلد دیگر (name:val)', labelEn: 'Other Field Value', hint: 'elm_max_devices:2' },
];

export const CustomFieldsView: React.FC<Props> = ({ state, lang, onSaveGroup, onDeleteGroup }) => {
  const [selectedId, setSelectedId] = useState<string>(state.customFieldGroups[0]?.id ?? '');
  const activeGroup =
    state.customFieldGroups.find((g) => g.id === selectedId) ?? state.customFieldGroups[0];

  const [draft, setDraft] = useState<CustomFieldGroup>(
    activeGroup ?? {
      id: `fg_${Date.now()}`,
      title: 'گروه فیلد سفارشی جدید',
      slug: 'new-custom-group',
      targets: ['wc_product'],
      autoInjectFrontend: true,
      injectHook: 'wc_single_product_summary',
      conditions: [],
      fields: [],
      active: true,
    }
  );
  const [saving, setSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Condition Evaluator Simulator state
  const [evalTarget, setEvalTarget] = useState<CustomFieldTarget>('wc_product');
  const [evalLoggedIn, setEvalLoggedIn] = useState(true);
  const [evalRole, setEvalRole] = useState('customer');
  const [evalProductType, setEvalProductType] = useState('variable');
  const [evalUrl, setEvalUrl] = useState('/product/yektap-crm-license');
  const [evalHasLicense, setEvalHasLicense] = useState(true);
  const [evalResult, setEvalResult] = useState<{
    passed: boolean;
    targetMatched: boolean;
    ruleResults: Array<{ ruleId: string; param: string; expected: string; actual: string; passed: boolean }>;
  } | null>(null);

  const selectGroup = (grp: CustomFieldGroup) => {
    setSelectedId(grp.id);
    setDraft(JSON.parse(JSON.stringify(grp)) as CustomFieldGroup);
    setEvalTarget(grp.targets[0] ?? 'wc_product');
    setEvalResult(null);
  };

  const createBlankGroup = () => {
    const fresh: CustomFieldGroup = {
      id: `fg_${Date.now()}`,
      title: lang === 'fa' ? 'گروه فیلد جدید' : 'New Field Group',
      slug: `group-${Date.now().toString().slice(-4)}`,
      targets: ['wc_product', 'wp_user'],
      autoInjectFrontend: true,
      injectHook: 'wc_single_product_summary',
      conditions: [{ id: `c_${Date.now()}`, param: 'user_logged_in', operator: 'equals', value: 'true' }],
      fields: [
        {
          id: `f_${Date.now()}`,
          name: 'elm_custom_note',
          label: 'توضیحات اختصاصی لایسنس',
          type: 'text',
          required: false,
          defaultValue: '',
          choices: [],
          showInReport: true,
        },
      ],
      active: true,
    };
    setSelectedId(fresh.id);
    setDraft(fresh);
    setEvalResult(null);
  };

  const toggleTarget = (t: CustomFieldTarget) => {
    setDraft((prev) => ({
      ...prev,
      targets: prev.targets.includes(t) ? prev.targets.filter((x) => x !== t) : [...prev.targets, t],
    }));
  };

  const addField = () => {
    const item: CustomFieldItem = {
      id: `f_${Date.now()}`,
      name: `elm_field_${draft.fields.length + 1}`,
      label: `فیلد سفارشی ${draft.fields.length + 1}`,
      type: 'text',
      required: false,
      defaultValue: '',
      choices: ['گزینه ۱', 'گزینه ۲'],
      subFields: [{ name: 'title', label: 'عنوان', type: 'text' }],
      showInReport: true,
    };
    setDraft((prev) => ({ ...prev, fields: [...prev.fields, item] }));
  };

  const updateField = (id: string, patch: Partial<CustomFieldItem>) => {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  };

  const removeField = (id: string) => {
    setDraft((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== id) }));
  };

  const addCondition = () => {
    const rule: FieldConditionRule = {
      id: `c_${Date.now()}`,
      param: 'user_logged_in',
      operator: 'equals',
      value: 'true',
    };
    setDraft((prev) => ({ ...prev, conditions: [...prev.conditions, rule] }));
  };

  const updateCondition = (id: string, patch: Partial<FieldConditionRule>) => {
    setDraft((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const removeCondition = (id: string) => {
    setDraft((prev) => ({ ...prev, conditions: prev.conditions.filter((c) => c.id !== id) }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveGroup(draft);
    } finally {
      setSaving(false);
    }
  };

  const handleRunEvaluator = async () => {
    await onSaveGroup(draft);
    const res = await fetchJson<{
      ok: boolean;
      passed: boolean;
      targetMatched: boolean;
      ruleResults: Array<{ ruleId: string; param: string; expected: string; actual: string; passed: boolean }>;
    }>('/api/sim/custom-fields/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: draft.id,
        target: evalTarget,
        user_logged_in: evalLoggedIn,
        user_role: evalRole,
        page_id: '42',
        url_pattern: evalUrl,
        wc_product_type: evalProductType,
        wc_variation_id: 'var_1m_2',
        has_active_license: evalHasLicense,
        field_values: { elm_max_devices: '2' },
      }),
    });
    setEvalResult(res);
  };

  const firstField = draft.fields[0]?.name || 'elm_custom_field';
  const developerSnippet = `// 1. استفاده در قالب وردپرس (Template Tags مشابه ACF و استاندارد WP):
$val = elm_get_field( '${firstField}', get_the_ID() );
elm_the_field( '${firstField}', get_the_ID() );

// 2. خواندن مستقیم از متای استاندارد وردپرس یا سفارش HPOS:
$raw_meta = get_post_meta( get_the_ID(), '${firstField}', true );
// یا برای سفارش ووکامرس HPOS:
$order_val = $order->get_meta( '${firstField}' );

// 3. شورت‌کد درون برگه / نوشته / المنتور:
[elm_field name="${firstField}" object_id="${draft.targets.includes('wp_user') ? 'current_user' : 'current'}"]

// 4. بلوک گوتنبرگ و تزریق خودکار بدون ویرایش قالب:
// هوک فعال: ${draft.injectHook} (تزریق خودکار فقط در صورت تحقق شرط‌های گروه)`;

  const copySnippet = async () => {
    await navigator.clipboard.writeText(developerSnippet);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1600);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Field Groups List */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-800" />
              <h2 className="text-sm font-semibold text-slate-900">
                {lang === 'fa' ? 'گروه‌های فیلد سفارشی (ACF Engine)' : 'Custom Field Groups'}
              </h2>
            </div>
            <button
              type="button"
              onClick={createBlankGroup}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'fa' ? 'گروه جدید' : 'New Group'}</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {state.customFieldGroups.map((g) => {
              const selected = draft.id === g.id;
              return (
                <div
                  key={g.id}
                  className={`py-2.5 px-2.5 rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    selected ? 'bg-sky-50 border border-sky-200' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => selectGroup(g)}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">{g.title}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                      {g.fields.length} فیلد · {g.conditions.length} شرط · {g.autoInjectFrontend ? 'تزریق خودکار قالب' : 'دستی / شورت‌کد'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDeleteGroup(g.id);
                    }}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                    title="حذف گروه"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Group Builder Form */}
        <form onSubmit={handleSave} className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">عنوان گروه فیلد</label>
              <input
                type="text"
                required
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">شناسه یکتا (Slug)</label>
              <input
                type="text"
                dir="ltr"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Targets (Post, Page, User, WC Product/Variation, HPOS Order) */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700">
              محل اتصال در پایگاه داده استاندارد وردپرس (wp_postmeta / wp_usermeta / HPOS):
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TARGET_OPTIONS.map((t) => {
                const active = draft.targets.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTarget(t.id)}
                    className={`px-3 py-2 text-xs rounded-lg border text-start transition-colors ${
                      active
                        ? 'bg-sky-900 text-white border-sky-900 font-medium'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {lang === 'fa' ? t.labelFa : t.labelEn}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Frontend Auto-Injection */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.autoInjectFrontend}
                onChange={(e) => setDraft({ ...draft, autoInjectFrontend: e.target.checked })}
              />
              <span>تزریق خودکار در بخش‌های استاندارد قالب فرانت‌اند (در صورت تحقق شرط‌ها)</span>
            </label>
            <select
              value={draft.injectHook}
              onChange={(e) => setDraft({ ...draft, injectHook: e.target.value as CustomFieldGroup['injectHook'] })}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-mono"
            >
              <option value="wc_single_product_summary">woocommerce_single_product_summary</option>
              <option value="wc_before_add_to_cart">woocommerce_before_add_to_cart_button</option>
              <option value="wc_account_dashboard">woocommerce_account_dashboard</option>
              <option value="the_content_after">the_content (پست‌ها و برگه‌ها)</option>
            </select>
          </div>

          {/* Fields List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-900">فیلدهای داخل گروه ({draft.fields.length})</div>
              <button
                type="button"
                onClick={addField}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>افزودن فیلد</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {draft.fields.map((field) => (
                <div key={field.id} className="p-3 border border-slate-200 rounded-lg bg-slate-50/70 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                      placeholder="برچسب نمایشی فارسی"
                      className="sm:col-span-4 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                    />
                    <input
                      type="text"
                      dir="ltr"
                      value={field.name}
                      onChange={(e) => updateField(field.id, { name: e.target.value })}
                      placeholder="meta_key_name"
                      className="sm:col-span-3 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
                    />
                    <select
                      value={field.type}
                      onChange={(e) => updateField(field.id, { type: e.target.value as CustomFieldType })}
                      className="sm:col-span-4 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                    >
                      {FIELD_TYPES.map((ft) => (
                        <option key={ft.id} value={ft.id}>
                          {lang === 'fa' ? ft.labelFa : ft.labelEn}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="sm:col-span-1 p-1.5 text-slate-400 hover:text-red-600 justify-self-end"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600">
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(field.id, { required: e.target.checked })}
                        />
                        <span>اجباری</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={field.showInReport}
                          onChange={(e) => updateField(field.id, { showInReport: e.target.checked })}
                        />
                        <span>نمایش در گزارش و اکسل</span>
                      </label>
                    </div>
                    {(field.type === 'select' || field.type === 'checkbox' || field.type === 'radio') && (
                      <input
                        type="text"
                        value={field.choices.join('، ')}
                        onChange={(e) =>
                          updateField(field.id, {
                            choices: e.target.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean),
                          })
                        }
                        placeholder="گزینه‌ها با ویرگول جدا شوند..."
                        className="flex-1 min-w-[200px] px-2.5 py-1 border border-slate-300 rounded bg-white"
                      />
                    )}
                    {field.type === 'repeater' && (
                      <span className="text-sky-800 font-medium">
                        زیرفیلدها: {(field.subFields ?? []).map((sf) => sf.label).join('، ') || 'عنوان، لینک'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Conditional Rules Engine */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-900">
                موتور شرط فعال‌سازی و نمایش (Backend + Frontend)
              </div>
              <button
                type="button"
                onClick={addCondition}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>افزودن شرط</span>
              </button>
            </div>

            {draft.conditions.length === 0 ? (
              <div className="p-3 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">
                بدون شرط محدودکننده: فیلدها در تمام هدف‌های انتخاب‌شده نمایش داده می‌شوند.
              </div>
            ) : (
              <div className="space-y-2">
                {draft.conditions.map((rule) => {
                  const meta = CONDITION_PARAMS.find((p) => p.id === rule.param);
                  return (
                    <div key={rule.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                      <select
                        value={rule.param}
                        onChange={(e) => updateCondition(rule.id, { param: e.target.value as ConditionParam })}
                        className="sm:col-span-5 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      >
                        {CONDITION_PARAMS.map((cp) => (
                          <option key={cp.id} value={cp.id}>
                            {lang === 'fa' ? cp.labelFa : cp.labelEn}
                          </option>
                        ))}
                      </select>
                      <select
                        value={rule.operator}
                        onChange={(e) =>
                          updateCondition(rule.id, { operator: e.target.value as FieldConditionRule['operator'] })
                        }
                        className="sm:col-span-3 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="equals">برابر باشد با</option>
                        <option value="not_equals">برابر نباشد با</option>
                        <option value="contains">شامل باشد</option>
                      </select>
                      <input
                        type="text"
                        dir="ltr"
                        value={rule.value}
                        onChange={(e) => updateCondition(rule.id, { value: e.target.value })}
                        placeholder={meta?.hint || 'value'}
                        className="sm:col-span-3 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => removeCondition(rule.id)}
                        className="sm:col-span-1 p-1.5 text-slate-400 hover:text-red-600 justify-self-end"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900"
            >
              {saving ? 'در حال ذخیره...' : 'ذخیره گروه فیلد در پلاگین'}
            </button>
            <span className="text-[11px] text-slate-500 font-mono">register_meta() + elm_get_field()</span>
          </div>
        </form>
      </div>

      {/* Live Condition Evaluator + Developer Template Tags */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">تست زنده موتور شرط نمایش (Backend / Frontend Evaluator)</h3>
            <button
              type="button"
              onClick={handleRunEvaluator}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              <Play className="w-3.5 h-3.5" />
              <span>اجرای ارزیابی شرط</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <select
              value={evalTarget}
              onChange={(e) => setEvalTarget(e.target.value as CustomFieldTarget)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
            >
              {TARGET_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.labelFa}
                </option>
              ))}
            </select>
            <select
              value={evalProductType}
              onChange={(e) => setEvalProductType(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
            >
              <option value="variable">نوع محصول: variable</option>
              <option value="simple">نوع محصول: simple</option>
            </select>
            <select
              value={evalRole}
              onChange={(e) => setEvalRole(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
            >
              <option value="customer">نقش: customer</option>
              <option value="administrator">نقش: administrator</option>
            </select>
            <input
              type="text"
              dir="ltr"
              value={evalUrl}
              onChange={(e) => setEvalUrl(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg font-mono"
            />
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50">
              <input type="checkbox" checked={evalLoggedIn} onChange={(e) => setEvalLoggedIn(e.target.checked)} />
              <span>لاگین شده</span>
            </label>
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50">
              <input type="checkbox" checked={evalHasLicense} onChange={(e) => setEvalHasLicense(e.target.checked)} />
              <span>لایسنس فعال دارد</span>
            </label>
          </div>

          {evalResult && (
            <div
              className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                evalResult.passed ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="font-semibold">
                {evalResult.passed
                  ? 'نتیجه: تمام شرط‌ها برقرار است — فیلدها در Backend و Frontend نمایش و تزریق می‌شوند.'
                  : 'نتیجه: حداقل یک شرط یا هدف برقرار نیست — فیلدها مخفی می‌مانند.'}
              </div>
              {evalResult.ruleResults.map((r) => (
                <div key={r.ruleId} className="font-mono text-[11px]" dir="ltr">
                  [{r.passed ? 'PASS' : 'FAIL'}] {r.param} {r.expected} (actual: &quot;{r.actual}&quot;)
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-sky-800" />
              <span className="text-xs font-semibold text-slate-900">توابع استاندارد PHP، شورت‌کد و بلوک گوتنبرگ</span>
            </div>
            <button
              type="button"
              onClick={copySnippet}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'کپی شد' : 'کپی کد'}</span>
            </button>
          </div>
          <pre dir="ltr" className="p-4 bg-slate-950 text-sky-200 text-xs font-mono overflow-x-auto leading-relaxed">
            <code>{developerSnippet}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
