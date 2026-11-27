import type { CalendarType } from './types.js';

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const PERSIAN_MONTHS_EN = [
  'Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar',
  'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand',
];

const HIJRI_MONTHS = [
  'محرم', 'صفر', 'ربیع‌الاول', 'ربیع‌الثانی', 'جمادی‌الاول', 'جمادی‌الثانی',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذیقعده', 'ذیحجه',
];

const HIJRI_MONTHS_EN = [
  'Muharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II',
  'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qidah', 'Dhu al-Hijjah',
];

const GREGORIAN_MONTHS_FA = [
  'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
  'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر',
];

const GREGORIAN_MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function toPersianDigits(input: string | number): string {
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(input).replace(/\d/g, (d) => map[Number(d)]);
}

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/**
 * Exact Gregorian to Jalali conversion (matching PHP Calendar class 33-year cycle).
 */
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) +
    gd +
    gdm[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/**
 * Exact Gregorian to Islamic Hijri (Kuwaiti / Civil arithmetic algorithm matching PHP Calendar class).
 */
export function gregorianToHijri(gy: number, gm: number, gd: number): [number, number, number] {
  let y = gy;
  let m = gm;
  if (m < 3) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + gd + b - 1524;

  const l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  let l2 = l - 10631 * n + 354;
  const j =
    Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) +
    Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
  l2 =
    l2 -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;
  const hm = Math.floor((24 * l2) / 709);
  const hd = l2 - Math.floor((709 * hm) / 24);
  const hy = 30 * n + j - 30;
  return [hy, hm, hd];
}

export function formatCalendarDate(
  isoDate: string | null,
  calendar: CalendarType,
  lang: 'fa' | 'en' = 'fa',
  includeTime = false
): string {
  if (!isoDate) return lang === 'fa' ? '—' : '—';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;

  const gy = date.getUTCFullYear();
  const gm = date.getUTCMonth() + 1;
  const gd = date.getUTCDate();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const timeStr = includeTime ? ` ${hh}:${mm}` : '';

  if (calendar === 'jalali') {
    const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
    const monthName = lang === 'fa' ? PERSIAN_MONTHS[jm - 1] : PERSIAN_MONTHS_EN[jm - 1];
    const formatted = `${jd} ${monthName} ${jy}${timeStr}`;
    return lang === 'fa' ? toPersianDigits(formatted) : formatted;
  }

  if (calendar === 'hijri') {
    const [hy, hm, hd] = gregorianToHijri(gy, gm, gd);
    const monthName = lang === 'fa' ? HIJRI_MONTHS[hm - 1] : HIJRI_MONTHS_EN[hm - 1];
    const formatted = `${hd} ${monthName} ${hy}${timeStr}`;
    return lang === 'fa' ? toPersianDigits(formatted) : formatted;
  }

  const monthName = lang === 'fa' ? GREGORIAN_MONTHS_FA[gm - 1] : GREGORIAN_MONTHS_EN[gm - 1];
  const formatted = `${gd} ${monthName} ${gy}${timeStr}`;
  return lang === 'fa' ? toPersianDigits(formatted) : formatted;
}

export function formatRemainingTime(expiresAt: string | null, lang: 'fa' | 'en', nowMs = Date.now()): string {
  if (!expiresAt) {
    return lang === 'fa' ? 'همیشگی (نامحدود)' : 'Lifetime';
  }
  const diffMs = new Date(expiresAt).getTime() - nowMs;
  if (diffMs <= 0) {
    return lang === 'fa' ? 'منقضی‌شده' : 'Expired';
  }
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (lang === 'fa') {
    if (days > 0) {
      return toPersianDigits(`${days} روز و ${hours} ساعت`);
    }
    return toPersianDigits(`${hours} ساعت`);
  }
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}
