import JSZip from 'jszip';
import type { PluginVirtualFile } from '../../shared/types.js';
import {
  buildCalendarPhp,
  buildCryptoPhp,
  buildMainPluginPhp,
  buildUninstallPhp,
  type PluginBuildOptions,
} from './core-php.js';
import { buildCustomFieldsPhp } from './custom-fields-php.js';
import { buildPromoCptPhp, buildRestApiPhp, buildWooCommercePhp } from './woo-api-php.js';
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
      description: 'فایل اصلی افزونه (PHP 8.2+، سازگار با HPOS، نصب/حذف خودکار پچ mu-plugins)',
      content: buildMainPluginPhp(opts),
    },
    {
      path: 'epic-license-manager/uninstall.php',
      language: 'php',
      description: 'پاکسازی خودکار فایل پچ mu-plugins هنگام حذف افزونه از وردپرس',
      content: buildUninstallPhp(),
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
      description: 'موتور Ed25519 (Sodium) با خروجی همزمان Hex/Base64، ویرایش کلید و تست امضا',
      content: buildCryptoPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-custom-fields.php',
      language: 'php',
      description: 'سیستم فیلدساز سفارشی استاندارد وردپرس با شروط نمایش و تزریق خودکار قالب',
      content: buildCustomFieldsPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-promo-cpt.php',
      language: 'php',
      description: 'پست‌تایپ تبلیغات موبایل با لینک اختصاصی و صفحه سبک بدون هدر/فوتر + پل اپ',
      content: buildPromoCptPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-woocommerce.php',
      language: 'php',
      description: 'اتصال ووکامرس: تسویه‌حساب شرطی فقط برای سبد لایسنس‌دار و نگاشت ۱ تا ۱۰ کلید',
      content: buildWooCommercePhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-rest-api.php',
      language: 'php',
      description: 'نقاط پایانی REST API با روتر پیوندیکتای ساده و محافظ خروجی JSON',
      content: buildRestApiPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-reports.php',
      language: 'php',
      description: 'گزارش جامع دستگاه/سفارش/خطا/ACF با خروجی واقعی اکسل XLSX و CSV سمی‌کالنی',
      content: buildReportsPhp(),
    },
    {
      path: 'epic-license-manager/includes/class-elm-admin.php',
      language: 'php',
      description: 'پیشخوان کامل وردپرس شامل شبیه‌ساز گوشی، فرم بصری تبلیغات و کدساز واقعی',
      content: buildAdminPhp(),
    },
    {
      path: 'epic-license-manager/assets/admin.css',
      language: 'css',
      description: 'استایل کپسوله‌شده پیشخوان مدرن وردپرس',
      content: adminCss,
    },
    {
      path: 'epic-license-manager/assets/admin.js',
      language: 'js',
      description: 'اسکریپت تست زنده امضا و شبیه‌ساز گوشی داخل پیشخوان وردپرس',
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
      description: 'راهنمای همگام‌سازی کلید Ed25519 و رفع خطای پیوندیکتای ساده',
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
