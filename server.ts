import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { buildPluginZipBuffer, generatePluginFiles } from './src/server/plugin-files/index.js';
import { simulatorStore } from './src/server/simulator.js';
import type { CalendarSettings, CustomFieldGroup, OrderStatus, PromoConfig } from './src/shared/types.js';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 1. Plugin Source Files Inspector & Installable ZIP Packager
  app.get('/api/plugin/files', (_req, res) => {
    const state = simulatorStore.getState();
    const files = generatePluginFiles({
      storeDomain: state.woocommerce.storeDomain,
      triggerStatuses: state.woocommerce.triggerStatuses,
      publicCalendar: state.calendar.publicCalendar,
      adminCalendar: state.calendar.adminCalendar,
      pluginCalendar: state.calendar.pluginCalendar,
    });
    res.json({ ok: true, files });
  });

  app.get('/api/plugin/download', async (_req, res) => {
    try {
      const state = simulatorStore.getState();
      const zipBuffer = await buildPluginZipBuffer({
        storeDomain: state.woocommerce.storeDomain,
        triggerStatuses: state.woocommerce.triggerStatuses,
        publicCalendar: state.calendar.publicCalendar,
        adminCalendar: state.calendar.adminCalendar,
        pluginCalendar: state.calendar.pluginCalendar,
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="epic-license-manager.zip"');
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'ZIP build failed' });
    }
  });

  // 2. Simulator State & Configuration Endpoints
  app.get('/api/sim/state', (_req, res) => {
    res.json({ ok: true, state: simulatorStore.getState() });
  });

  app.post('/api/sim/reset', (_req, res) => {
    res.json({ ok: true, state: simulatorStore.reset() });
  });

  app.post('/api/sim/clear-sandbox', (_req, res) => {
    const result = simulatorStore.clearTestSandboxRecords();
    res.json({ ok: true, ...result });
  });

  app.put('/api/sim/settings/calendar', (req, res) => {
    const body = req.body as Partial<CalendarSettings>;
    const allowed = new Set(['gregorian', 'jalali', 'hijri']);
    const cur = simulatorStore.getState().calendar;
    const next: CalendarSettings = {
      publicCalendar: allowed.has(body.publicCalendar ?? '') ? body.publicCalendar! : cur.publicCalendar,
      adminCalendar: allowed.has(body.adminCalendar ?? '') ? body.adminCalendar! : cur.adminCalendar,
      pluginCalendar: allowed.has(body.pluginCalendar ?? '') ? body.pluginCalendar! : cur.pluginCalendar,
    };
    res.json({ ok: true, calendar: simulatorStore.updateCalendar(next) });
  });

  app.put('/api/sim/settings/woocommerce', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const updated = simulatorStore.updateWooSettings({
      storeDomain: typeof body.storeDomain === 'string' && body.storeDomain.trim() ? body.storeDomain.trim() : undefined,
      triggerStatuses: Array.isArray(body.triggerStatuses)
        ? (body.triggerStatuses.filter((s): s is OrderStatus => typeof s === 'string') as OrderStatus[])
        : undefined,
      conditionalCartRegistration:
        typeof body.conditionalCartRegistration === 'boolean' ? body.conditionalCartRegistration : undefined,
    });
    res.json({ ok: true, woocommerce: updated });
  });

  // 3. Mobile HTML Promo CPT CRUD & Dedicated Lightweight CPT HTML View
  app.post('/api/sim/promos', (req, res) => {
    const body = req.body as Partial<PromoConfig> & { autoBuildHtml?: boolean };
    const updated = simulatorStore.upsertPromo(body);
    res.json({ ok: true, promo: updated });
  });

  app.put('/api/sim/promo', (req, res) => {
    const body = req.body as Partial<PromoConfig> & { autoBuildHtml?: boolean };
    const updated = simulatorStore.upsertPromo(body);
    res.json({ ok: true, promo: updated });
  });

  app.get('/elm-promo/:slug', (req, res) => {
    const state = simulatorStore.getState();
    const promo = state.promos.find((p) => p.slug === req.params.slug) ?? state.promos[0];
    if (!promo) {
      res.status(404).send('Promo not found');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${promo.title}</title>
  <style>
    body { margin: 0; padding: 16px; background: #f8fafc; font-family: Tahoma, system-ui, sans-serif; color: #0f172a; }
    .elm-card { max-width: 460px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgba(15,23,42,.08); }
    .elm-cta { display: block; width: 100%; box-sizing: border-box; text-align: center; background: ${promo.themeColor}; color: #fff; text-decoration: none; font-weight: 700; font-size: 13px; padding: 12px 16px; border-radius: 10px; margin-top: 16px; }
    .elm-close { display: block; width: 100%; background: transparent; border: 0; color: #64748b; font-size: 12px; padding: 10px; margin-top: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="elm-card">
    ${promo.htmlContent}
    <a href="${promo.ctaUrl}" target="_blank" rel="noreferrer" class="elm-cta">${promo.ctaLabel}</a>
    <button type="button" class="elm-close" onclick="elmClosePromo()">بستن</button>
  </div>
  <script>
    function elmClosePromo() {
      if (window.AndroidBridge && typeof window.AndroidBridge.closePromo === 'function') {
        window.AndroidBridge.closePromo();
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage('elm_close_promo', '*');
      }
    }
  </script>
</body>
</html>`);
  });

  // 4. Apps Registration, Editing, Toggle & Live Ed25519 Signature Testing
  app.post('/api/sim/apps', (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (typeof body.slug !== 'string' || typeof body.name !== 'string' || !body.slug.trim() || !body.name.trim()) {
      res.status(400).json({ ok: false, error: 'نام و شناسه اپلیکیشن الزامی است.' });
      return;
    }
    const created = simulatorStore.createOrImportApp({
      slug: body.slug,
      name: body.name,
      platform: body.platform === 'web' || body.platform === 'cross_platform' ? body.platform : 'android',
      mode: body.mode === 'method1_gated' ? 'method1_gated' : 'method2_trial',
      trialDays: typeof body.trialDays === 'number' ? body.trialDays : 14,
      offlineGraceDays: typeof body.offlineGraceDays === 'number' ? body.offlineGraceDays : 14,
      purchaseUrl: typeof body.purchaseUrl === 'string' ? body.purchaseUrl : '',
      gatedFeatures: Array.isArray(body.gatedFeatures)
        ? body.gatedFeatures.filter((x): x is string => typeof x === 'string')
        : [],
      customSeedHex: typeof body.customSeedHex === 'string' ? body.customSeedHex : undefined,
    });
    res.json({ ok: true, app: created });
  });

  app.put('/api/sim/apps/:id', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const updated = simulatorStore.updateApp(req.params.id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      platform: body.platform === 'web' || body.platform === 'android' || body.platform === 'cross_platform' ? body.platform : undefined,
      mode: body.mode === 'method1_gated' || body.mode === 'method2_trial' ? body.mode : undefined,
      trialDays: typeof body.trialDays === 'number' ? body.trialDays : undefined,
      offlineGraceDays: typeof body.offlineGraceDays === 'number' ? body.offlineGraceDays : undefined,
      purchaseUrl: typeof body.purchaseUrl === 'string' ? body.purchaseUrl : undefined,
      gatedFeatures: Array.isArray(body.gatedFeatures)
        ? body.gatedFeatures.filter((x): x is string => typeof x === 'string')
        : undefined,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      regenerateKeys: Boolean(body.regenerateKeys),
      customSeedHex: typeof body.customSeedHex === 'string' ? body.customSeedHex : undefined,
      publicKeyHexOverride: typeof body.publicKeyHexOverride === 'string' ? body.publicKeyHexOverride : undefined,
    });
    if (!updated) {
      res.status(404).json({ ok: false, error: 'اپلیکیشن یافت نشد.' });
      return;
    }
    res.json({ ok: true, app: updated });
  });

  app.post('/api/sim/apps/:id/toggle', (req, res) => {
    const cur = simulatorStore.getState().apps.find((a) => a.id === req.params.id || a.slug === req.params.id);
    if (!cur) {
      res.status(404).json({ ok: false, error: 'اپلیکیشن یافت نشد.' });
      return;
    }
    const updated = simulatorStore.updateApp(cur.id, { isActive: !cur.isActive });
    res.json({ ok: true, app: updated });
  });

  app.post('/api/sim/apps/:id/test-signature', (req, res) => {
    const note = typeof (req.body as { note?: string })?.note === 'string' ? (req.body as { note?: string }).note : undefined;
    const result = simulatorStore.testAppSignature(req.params.id, note);
    if (!result) {
      res.status(404).json({ ok: false, error: 'اپلیکیشن یافت نشد.' });
      return;
    }
    res.json(result);
  });

  // 5. ACF-Style Custom Fields Builder & Conditional Logic Evaluator
  app.post('/api/sim/custom-fields', (req, res) => {
    const body = req.body as CustomFieldGroup;
    if (!body || !body.title?.trim()) {
      res.status(400).json({ ok: false, error: 'عنوان گروه فیلد الزامی است.' });
      return;
    }
    const saved = simulatorStore.upsertCustomFieldGroup(body);
    res.json({ ok: true, group: saved });
  });

  app.delete('/api/sim/custom-fields/:id', (req, res) => {
    const ok = simulatorStore.deleteCustomFieldGroup(req.params.id);
    res.status(ok ? 200 : 404).json({ ok });
  });

  app.post('/api/sim/custom-fields/evaluate', (req, res) => {
    const body = req.body as {
      groupId: string;
      target: string;
      user_logged_in: boolean;
      user_role: string;
      page_id: string;
      url_pattern: string;
      wc_product_type: string;
      wc_variation_id: string;
      has_active_license: boolean;
      field_values: Record<string, string>;
    };
    const result = simulatorStore.evaluateCustomFieldConditions(body.groupId, body);
    res.json({ ok: true, ...result });
  });

  // 6. WooCommerce Variations & Conditional Cart Checkout
  app.post('/api/sim/products/map', (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (typeof body.productName !== 'string' || typeof body.variationLabel !== 'string' || typeof body.appSlug !== 'string') {
      res.status(400).json({ ok: false, error: 'اطلاعات متغیر محصول ناقص است.' });
      return;
    }
    const mapped = simulatorStore.upsertVariation({
      id: typeof body.id === 'string' ? body.id : undefined,
      productName: body.productName,
      variationLabel: body.variationLabel,
      appSlug: body.appSlug,
      duration:
        body.duration === '1m' || body.duration === '3m' || body.duration === '1y' || body.duration === 'lifetime'
          ? body.duration
          : '1m',
      licenseQuantity: typeof body.licenseQuantity === 'number' ? body.licenseQuantity : 1,
      regularPriceToman: typeof body.regularPriceToman === 'number' ? body.regularPriceToman : 100000,
      bundlePriceToman: typeof body.bundlePriceToman === 'number' ? body.bundlePriceToman : 100000,
    });
    res.json({ ok: true, variation: mapped });
  });

  app.post('/api/sim/orders/checkout', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = simulatorStore.checkoutOrder({
      hasLicensedProduct: typeof body.hasLicensedProduct === 'boolean' ? body.hasLicensedProduct : true,
      isGuestAttempt: Boolean(body.isGuestAttempt),
      createAccountAtCheckout: Boolean(body.createAccountAtCheckout),
      paymentMethod: typeof body.paymentMethod === 'string' ? body.paymentMethod : 'زرین‌پال (Zarinpal)',
      firstName: typeof body.firstName === 'string' ? body.firstName : '',
      lastName: typeof body.lastName === 'string' ? body.lastName : '',
      mobile: typeof body.mobile === 'string' ? body.mobile : '',
      email: typeof body.email === 'string' ? body.email : '',
      variationId: typeof body.variationId === 'string' ? body.variationId : '',
      quantityOrdered: typeof body.quantityOrdered === 'number' ? body.quantityOrdered : 1,
      initialStatus:
        typeof body.initialStatus === 'string' ? (body.initialStatus as OrderStatus) : 'completed',
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.patch('/api/sim/orders/:id/status', (req, res) => {
    const orderId = Number(req.params.id);
    const status = (req.body as { status?: OrderStatus }).status;
    if (!Number.isFinite(orderId) || !status) {
      res.status(400).json({ ok: false, error: 'شناسه سفارش یا وضعیت نامعتبر است.' });
      return;
    }
    const updated = simulatorStore.updateOrderStatus(orderId, status);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'سفارش یافت نشد.' });
      return;
    }
    res.json({ ok: true, ...updated });
  });

  // 7. Live REST API Endpoints mirroring /wp-json/elm/v1/* & /?rest_route=/elm/v1/*
  app.get('/api/sim/v1/app/handshake', (req, res) => {
    const appSlug = typeof req.query.app_slug === 'string' ? req.query.app_slug : 'yektap-crm-mobile';
    const plainRoute = req.query.plain_route === '1';
    const result = simulatorStore.apiHandshake(appSlug, plainRoute);
    res.status(result.status).json(result.data);
  });

  app.post('/api/sim/v1/trial/activate', (req, res) => {
    const body = req.body as {
      app_slug?: string;
      hardware_hash?: string;
      device_model?: string;
      os_version?: string;
      plain_route?: boolean;
      is_test_sandbox?: boolean;
    };
    const result = simulatorStore.apiActivateTrial({
      app_slug: body.app_slug || 'yektap-crm-mobile',
      hardware_hash: body.hardware_hash || '',
      device_model: body.device_model,
      os_version: body.os_version,
      plain_route: body.plain_route,
      is_test_sandbox: body.is_test_sandbox,
    });
    res.status(result.status).json(result.data);
  });

  app.post('/api/sim/v1/trial/expire-demo', (req, res) => {
    const body = req.body as { app_slug?: string; hardware_hash?: string };
    simulatorStore.apiExpireTrialForDemo(
      body.hardware_hash || 'demo-android-device-hash-01',
      body.app_slug || 'yektap-crm-mobile'
    );
    res.json({ ok: true });
  });

  app.post('/api/sim/v1/license/activate', (req, res) => {
    const body = req.body as {
      app_slug?: string;
      license_key?: string;
      hardware_hash?: string;
      device_model?: string;
      os_version?: string;
      plain_route?: boolean;
    };
    const result = simulatorStore.apiActivateLicense({
      app_slug: body.app_slug || 'yektap-crm-mobile',
      license_key: body.license_key || '',
      hardware_hash: body.hardware_hash || 'demo-android-device-hash-01',
      device_model: body.device_model,
      os_version: body.os_version,
      plain_route: body.plain_route,
    });
    res.status(result.status).json(result.data);
  });

  app.post('/api/sim/v1/license/verify', (req, res) => {
    const body = req.body as {
      app_slug?: string;
      license_key?: string;
      hardware_hash?: string;
      plain_route?: boolean;
    };
    const result = simulatorStore.apiVerifyLicense({
      app_slug: body.app_slug || 'yektap-crm-mobile',
      license_key: body.license_key || '',
      hardware_hash: body.hardware_hash || 'demo-android-device-hash-01',
      plain_route: body.plain_route,
    });
    res.status(result.status).json(result.data);
  });

  app.post('/api/sim/v1/token/inspect', (req, res) => {
    const body = req.body as { app_slug?: string; token?: string; public_key_hex_override?: string };
    if (!body.app_slug || !body.token) {
      res.status(400).json({ ok: false, error: 'Missing token or app_slug' });
      return;
    }
    const verified = simulatorStore.verifySignedToken(body.app_slug, body.token, body.public_key_hex_override);
    res.json({ ok: true, ...verified });
  });

  app.get('/api/sim/v1/promo', (req, res) => {
    const appSlug = typeof req.query.app_slug === 'string' ? req.query.app_slug : 'yektap-crm-mobile';
    const plainRoute = req.query.plain_route === '1';
    const result = simulatorStore.apiGetPromo(appSlug, plainRoute);
    res.status(result.status).json(result.data);
  });

  // 8. Genuine OOXML .xlsx & BOM Semicolon .csv Report Export
  app.get('/api/report/export', async (req, res) => {
    try {
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const lang = req.query.lang === 'en' ? 'en' : 'fa';
      const extraRaw = typeof req.query.extra === 'string' ? req.query.extra : '';
      const extraKeys = extraRaw ? extraRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const appSlug = typeof req.query.app === 'string' ? req.query.app : 'all';
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';
      const duration = typeof req.query.duration === 'string' ? req.query.duration : 'all';

      const file = await simulatorStore.buildExcelExport(format, extraKeys, lang, {
        appSlug,
        status,
        duration,
      });
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.content);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Export failed' });
    }
  });

  // Ensure unknown /api/* routes & errors always return JSON (never HTML fallback)
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'API endpoint not found' });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ ok: false, error: msg });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Epic License Manager Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
