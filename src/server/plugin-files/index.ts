import JSZip from 'jszip';
import type { PluginVirtualFile } from '../../shared/types.js';
import {
  buildCalendarPhp,
  buildCryptoPhp,
  buildMainPluginPhp,
  type PluginBuildOptions,
} from './core-php.js';
import { buildRestApiPhp, buildWooCommercePhp } from './woo-api-php.js';
import {
  buildAdminPhp,
  buildAssetsAndI18n,
  buildReportsPhp,
} from './admin-reports-php.js';

export function generatePluginFiles(opts: PluginBuildOptions): PluginVirtualFile[] {
  const { adminCss, adminJs, potFile, faPoFile, aiBlueprintMd } = buildAssetsAndI18n();

  return [
    {
      path: 'epic-license-manager/epic-license-manager.php',
      language: 'php',
      description: 'فایل اصلی افزونه (PHP 8.2+، سازگار با HPOS و ساخت جداول دیتابیس)',
      content: buildMainPluginPhp(opts),
    },
    {
      path: 'epic-license-manager/includes/class-elm-calendar.php',
      language: 'php',
      description: 'موتور تبدیل تقویم میلادی/شمسی/قمری بدون دستکاری هسته وردپرس',
      content: buildCalendarPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-crypto.php',
      language: 'php',
      description: 'موتور امضای آفلاین Ed25519 (libsodium) و HMAC-SHA256',
      content: buildCryptoPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-woocommerce.php',
      language: 'php',
      description: 'اتصال ووکامرس: اجبار ثبت‌نام، نگاشت باندل ۱ تا ۱۰ لایسنس و صدور با وضعیت سفارش',
      content: buildWooCommercePhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-rest-api.php',
      language: 'php',
      description: 'نقاط پایانی REST API برای اپلیکیشن اندروید و وب (/wp-json/elm/v1/*)',
      content: buildRestApiPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-reports.php',
      language: 'php',
      description: 'گزارش‌ساز پویا با پشتیبانی از فیلدهای ACF مشتریان و خروجی اکسل',
      content: buildReportsPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-admin.php',
      language: 'php',
      description: 'پنل مدیریت وردپرس (اپلیکیشن‌ها، تقویم سه‌گانه، گزارش و تبلیغات)',
      content: buildAdminPhp(),
    },
    {
      path: 'epic-license-manager/assets/admin.css',
      language: 'css',
      description: 'استایل رابط مدیریت وردپرس',
      content: adminCss,
    },
    {
      path: 'epic-license-manager/assets/admin.js',
      language: 'js',
      description: 'اسکریپت رابط مدیریت وردپرس',
      content: adminJs,
    },
    {
      path: 'epic-license-manager/languages/epic-license-manager.pot',
      language: 'po',
      description: 'قالب ترجمه استاندارد وردپرس (Multilingual POT)',
      content: potFile,
    },
    {
      path: 'epic-license-manager/languages/epic-license-manager-fa_IR.po',
      language: 'po',
      description: 'فایل ترجمه فارسی افزونه',
      content: faPoFile,
    },
    {
      path: 'epic-license-manager/docs/AI_STUDIO_BLUEPRINT.md',
      language: 'md',
      description: 'راهنمای استاندارد یکپارچه‌سازی برای Google AI Studio و توسعه‌دهندگان',
      content: aiBlueprintMd,
    },
  ];
}

export async function buildPluginZipBuffer(opts: PluginBuildOptions): Promise<Buffer> {
  const zip = new JSZip();
  const files = generatePluginFiles(opts);
  for (const f of files) {
    zip.file(f.path, f.content);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
