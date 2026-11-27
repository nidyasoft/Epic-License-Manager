import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { buildPluginZipBuffer, generatePluginFiles } from './src/server/plugin-files/index.js';
import { simulatorStore } from './src/server/simulator.js';
import type { CalendarSettings, OrderStatus } from './src/shared/types.js';

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
      blockGuestCheckout: typeof body.blockGuestCheckout === 'boolean' ? body.blockGuestCheckout : undefined,
    });
    res.json({ ok: true, woocommerce: updated });
  });

  app.put('/api/sim/promo', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const updated = simulatorStore.updatePromo({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      displayMode: body.displayMode === 'inline_banner' || body.displayMode === 'floating_modal' ? body.displayMode : undefined,
      intervalSeconds: typeof body.intervalSeconds === 'number' ? Math.max(5, Math.min(3600, body.intervalSeconds)) : undefined,
      showOnLockedClick: typeof body.showOnLockedClick === 'boolean' ? body.showOnLockedClick : undefined,
      ctaLabel: typeof body.ctaLabel === 'string' ? body.ctaLabel : undefined,
      ctaUrl: typeof body.ctaUrl === 'string' ? body.ctaUrl : undefined,
      htmlContent: typeof body.htmlContent === 'string' ? body.htmlContent : undefined,
    });
    res.json({ ok: true, promo: updated });
  });

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
    });
    res.json({ ok: true, app: created });
  });

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
      isGuestAttempt: Boolean(body.isGuestAttempt),
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

  // 3. Live REST API Endpoints mirroring /wp-json/elm/v1/*
  app.post('/api/sim/v1/trial/activate', (req, res) => {
    const body = req.body as {
      app_slug?: string;
      hardware_hash?: string;
      device_model?: string;
      os_version?: string;
    };
    const result = simulatorStore.apiActivateTrial({
      app_slug: body.app_slug || 'yektap-crm-mobile',
      hardware_hash: body.hardware_hash || '',
      device_model: body.device_model,
      os_version: body.os_version,
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
    };
    const result = simulatorStore.apiActivateLicense({
      app_slug: body.app_slug || 'yektap-crm-mobile',
      license_key: body.license_key || '',
      hardware_hash: body.hardware_hash || 'demo-android-device-hash-01',
      device_model: body.device_model,
    });
    res.status(result.status).json(result.data);
  });

  app.post('/api/sim/v1/license/verify', (req, res) => {
    const body = req.body as {
      app_slug?: string;
      license_key?: string;
      hardware_hash?: string;
    };
    const result = simulatorStore.apiVerifyLicense({
      app_slug: body.app_slug || 'yektap-crm-mobile',
      license_key: body.license_key || '',
      hardware_hash: body.hardware_hash || 'demo-android-device-hash-01',
    });
    res.status(result.status).json(result.data);
  });

  app.post('/api/sim/v1/token/inspect', (req, res) => {
    const body = req.body as { app_slug?: string; token?: string };
    if (!body.app_slug || !body.token) {
      res.status(400).json({ ok: false, error: 'Missing token or app_slug' });
      return;
    }
    const verified = simulatorStore.verifySignedToken(body.app_slug, body.token);
    res.json({ ok: true, ...verified });
  });

  app.get('/api/sim/v1/promo', (req, res) => {
    const appSlug = typeof req.query.app_slug === 'string' ? req.query.app_slug : 'yektap-crm-mobile';
    const result = simulatorStore.apiGetPromo(appSlug);
    res.status(result.status).json(result.data);
  });

  // 4. Dynamic Excel (.xls / .csv) Report Export
  app.get('/api/report/export', (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'xls';
    const lang = req.query.lang === 'en' ? 'en' : 'fa';
    const extraRaw = typeof req.query.extra === 'string' ? req.query.extra : '';
    const extraKeys = extraRaw ? extraRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const file = simulatorStore.buildExcelExport(format, extraKeys, lang);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.content);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Epic License Manager Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
