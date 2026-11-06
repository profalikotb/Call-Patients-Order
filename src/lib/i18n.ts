'use client';
import { useEffect, useState, useCallback } from 'react';

const D = {
  ar: {
    app: 'نظام الدور الذكي', login: 'تسجيل الدخول', username: 'اسم المستخدم', password: 'كلمة المرور', enter: 'دخول',
    badLogin: 'بيانات الدخول غير صحيحة', logout: 'خروج', reception: 'لوحة الاستقبال', display: 'شاشة الانتظار', admin: 'الإعدادات',
    current: 'الرقم الحالي', next: 'الرقم التالي', waiting: 'عدد المنتظرين', done: 'تم الكشف', absent: 'الغائبون',
    avg: 'متوسط الكشف', min: 'د', callNext: 'نداء المريض التالي', repeat: 'إعادة النداء', skip: 'تخطي المريض',
    inRoom: 'دخول الكشف', finish: 'إنهاء الكشف', refresh: 'تحديث القائمة', pause: 'إيقاف النداء', resume: 'استئناف النداء',
    undo: 'تراجع', walkin: 'إضافة مريض', summary: 'ملخص اليوم', search: 'بحث بالاسم أو رقم الحجز أو الموبايل',
    all: 'الكل', sheet: 'الشيت', live: 'مباشر', audio: 'الصوت', audioReady: 'جاهز', audioOff: 'غير مفعّل',
    lastSync: 'آخر مزامنة', estimate: 'تقديري', noCurrent: 'لا يوجد نداء حالي', emptyQueue: 'لا يوجد منتظرون',
    num: 'الرقم', time: 'الموعد', name: 'الاسم', status: 'الحالة', actions: 'إجراءات', est: 'الانتظار',
    paused: 'النداء الصوتي متوقف مؤقتاً', offline: 'غير متصل بالإنترنت', demo: 'وضع تجريبي – بيانات افتراضية',
  },
  en: {
    app: 'Smart Queue', login: 'Sign in', username: 'Username', password: 'Password', enter: 'Sign in',
    badLogin: 'Invalid credentials', logout: 'Sign out', reception: 'Reception', display: 'Waiting display', admin: 'Settings',
    current: 'Current', next: 'Next', waiting: 'Waiting', done: 'Seen', absent: 'Absent',
    avg: 'Avg consult', min: 'min', callNext: 'Call next patient', repeat: 'Repeat call', skip: 'Skip patient',
    inRoom: 'Into room', finish: 'Finish consult', refresh: 'Refresh list', pause: 'Pause voice', resume: 'Resume voice',
    undo: 'Undo', walkin: 'Add walk-in', summary: 'Daily summary', search: 'Search name, booking ID or phone',
    all: 'All', sheet: 'Sheet', live: 'Live', audio: 'Audio', audioReady: 'Ready', audioOff: 'Not active',
    lastSync: 'Last sync', estimate: 'estimate', noCurrent: 'No active call', emptyQueue: 'Nobody waiting',
    num: 'No.', time: 'Time', name: 'Name', status: 'Status', actions: 'Actions', est: 'Wait',
    paused: 'Voice announcements paused', offline: 'Offline', demo: 'Demo mode – sample data',
  },
} as const;
export type Lang = keyof typeof D;
export type Key = keyof (typeof D)['ar'];

export function useLang() {
  const [lang, setLang] = useState<Lang>('ar');
  useEffect(() => { try { const l = localStorage.getItem('pq_lang'); if (l === 'en') setLang('en'); } catch {} }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem('pq_lang', lang); } catch {}
  }, [lang]);
  const t = useCallback((k: Key) => D[lang][k], [lang]);
  return { lang, setLang, t, toggle: () => setLang(lang === 'ar' ? 'en' : 'ar') };
}
