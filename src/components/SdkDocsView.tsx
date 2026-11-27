import React, { useState } from 'react';
import { Bot, Check, Code2, Copy, FileJson } from 'lucide-react';
import {
  getAiStudioMasterPrompt,
  getAndroidGradleSnippet,
  getAndroidKotlinClient,
  getWebSdkSnippet,
} from '../data/sdkTemplates.js';
import type { SimulatorState } from '../shared/types.js';

interface Props {
  state: SimulatorState;
  lang: 'fa' | 'en';
}

export const SdkDocsView: React.FC<Props> = ({ state }) => {
  const [selectedSlug, setSelectedSlug] = useState(state.apps[0]?.slug ?? 'yektap-crm-mobile');
  const [activeTab, setActiveTab] = useState<'ai_prompt' | 'android' | 'web' | 'manifest'>('ai_prompt');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const app = state.apps.find((a) => a.slug === selectedSlug) ?? state.apps[0];
  const domain = state.woocommerce.storeDomain;

  const manifestJson = JSON.stringify(
    {
      schema_version: '2.0',
      app_slug: app.slug,
      app_name: app.name,
      platform: app.platform,
      license_mode: app.mode,
      trial_days: app.trialDays,
      offline_grace_days: app.offlineGraceDays,
      api_base: `https://${domain}/wp-json/elm/v1`,
      plain_permalink_fallback: `https://${domain}/?rest_route=/elm/v1`,
      purchase_url: app.purchaseUrl,
      gated_features: app.gatedFeatures,
      signing_alg: 'ed25519',
      public_key_hex: app.publicKeyHex,
      public_key_b64: app.publicKeyBase64,
    },
    null,
    2
  );

  const aiPrompt = getAiStudioMasterPrompt(domain);
  const gradleCode = getAndroidGradleSnippet();
  const kotlinCode = getAndroidKotlinClient(domain, app.slug, app.publicKeyHex);
  const webCode = getWebSdkSnippet(domain, app.slug);

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('ai_prompt')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'ai_prompt' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>پرامپت و پروتکل Google AI Studio</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('android')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'android' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>اندروید (Kotlin + Fallback)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('web')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'web' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>وب (React / Node.js)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manifest')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap inline-flex items-center gap-1.5 ${
              activeTab === 'manifest' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <FileJson className="w-3.5 h-3.5" />
            <span>Manifest استاندارد اتصال</span>
          </button>
        </div>

        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
        >
          {state.apps.map((a) => (
            <option key={a.id} value={a.slug}>
              تولید کد برای: {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tab Content */}
      {activeTab === 'ai_prompt' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                پرامپت مرجع و پروتکل پرسش‌گری هوشمند برای Google AI Studio
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                شامل پشتیبانی از `?rest_route=` روی پیوندیکتای ساده، گارد جلوگیری از خطای {'`<!DOCTYPE`'}، همگام‌سازی خودکار کلید ۶۴ کاراکتری Hex و `AndroidBridge.closePromo()`.
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyText(aiPrompt, 'ai_prompt')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-sky-800 text-white rounded-lg hover:bg-sky-900 whitespace-nowrap shrink-0"
            >
              {copiedKey === 'ai_prompt' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey === 'ai_prompt' ? 'کپی شد' : 'کپی دستورالعمل'}</span>
            </button>
          </div>

          <pre className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs leading-loose text-slate-800 whitespace-pre-wrap font-sans">
            {aiPrompt}
          </pre>
        </div>
      )}

      {activeTab === 'android' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">1. وابستگی‌های Gradle (قابل کامپایل در Android Studio)</span>
              <button
                type="button"
                onClick={() => copyText(gradleCode, 'gradle')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
              >
                {copiedKey === 'gradle' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>کپی</span>
              </button>
            </div>
            <pre dir="ltr" className="p-4 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto">
              <code>{gradleCode}</code>
            </pre>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                2. کلاینت کامل Kotlin (Failover پیوندیکتای ساده + گارد HTML + تشخیص مغایرت کلید Ed25519 + PromoAndroidBridge)
              </span>
              <button
                type="button"
                onClick={() => copyText(kotlinCode, 'kotlin')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
              >
                {copiedKey === 'kotlin' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>کپی</span>
              </button>
            </div>
            <pre dir="ltr" className="p-4 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto max-h-[480px]">
              <code>{kotlinCode}</code>
            </pre>
          </div>
        </div>
      )}

      {activeTab === 'web' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">کلاینت وب TypeScript / React / Node.js</span>
            <button
              type="button"
              onClick={() => copyText(webCode, 'web')}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
            >
              {copiedKey === 'web' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>کپی</span>
            </button>
          </div>
          <pre dir="ltr" className="p-4 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto">
            <code>{webCode}</code>
          </pre>
        </div>
      )}

      {activeTab === 'manifest' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-900">فایل قرارداد استاندارد elm-manifest.json</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                شامل `public_key_hex`، `public_key_b64` و مسیر `plain_permalink_fallback`.
              </div>
            </div>
            <button
              type="button"
              onClick={() => copyText(manifestJson, 'manifest')}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
            >
              {copiedKey === 'manifest' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>کپی JSON</span>
            </button>
          </div>
          <pre dir="ltr" className="p-4 bg-slate-950 text-sky-200 text-xs font-mono overflow-x-auto">
            <code>{manifestJson}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
