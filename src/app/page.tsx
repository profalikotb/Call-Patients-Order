'use client';
// ONE app icon → choose what to open (reception, TV screen, doctor messages, admin …)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n';

const BOOKING_PAGES: Record<string, string> = {
  heliopolis: 'https://script.google.com/macros/s/AKfycbyQJc5z3lW2PHEnX-3TMMQTYJQ2_2JM5vLaePhZfNTIJz8CpBKaoph84q0R4rtyWtc/exec',
  toukh: 'https://script.google.com/macros/s/AKfycbyiLRlx9aNNEcOxV3PtBz-JqRS23g-HC9hjN1Zu034-EAiqC6cW9MkSdFI3vjwpZHg/exec',
};

function Tile({ href, icon, title, sub, ext, big }: { href: string; icon: string; title: string; sub?: string; ext?: boolean; big?: boolean }) {
  const cls = `flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md active:scale-[.98] ${big ? 'sm:col-span-2' : ''}`;
  const body = (<>
    <img src={`/apps/${icon}-192.png`} alt="" className={`${big ? 'h-16 w-16' : 'h-12 w-12'} shrink-0 rounded-2xl`} />
    <span className="min-w-0"><span className={`block font-bold text-ink-900 ${big ? 'text-lg' : ''}`}>{title}</span>
      {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}</span>
  </>);
  return ext ? <a className={cls} href={href} target="_blank" rel="noreferrer">{body}</a> : <Link className={cls} href={href}>{body}</Link>;
}

export default function Home() {
  const { toggle, lang } = useLang();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch('/api/clinics')
      .then(async (r) => {
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || !j.ok) setErr(`خطأ في الخادم (${r.status}): ${j.detail || j.error || 'unknown'} — افتح /api/health`);
        setD(j);
      })
      .catch((e) => setErr(`تعذر الاتصال بالخادم: ${e?.message || e}`));
  }, []);
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }
  const admin = d?.session?.role === 'admin';
  // today's clinic (open session) first
  const clinics = [...(d?.clinics ?? [])].sort((a: any, b: any) => (b.id === d?.open_clinic ? 1 : 0) - (a.id === d?.open_clinic ? 1 : 0));
  return (
    <main className="mx-auto min-h-dvh max-w-3xl p-4 sm:p-8">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-ink-900">نظام الدور الذكي</h1>
          <p className="text-sm text-slate-500">أ.د. على قطب على · {d?.session?.name}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={toggle}>{lang === 'ar' ? 'EN' : 'ع'}</button>
          <button className="btn-ghost text-sm" onClick={logout}>خروج</button>
        </div>
      </header>
      {err && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200" dir="auto">{err}</p>}

      <div className="space-y-5">
        {clinics.map((c: any) => {
          const today = c.id === d?.open_clinic;
          const tv = d?.display_key ? `/display/${c.id}?k=${encodeURIComponent(d.display_key)}&label=${encodeURIComponent('شاشة ' + c.name_ar)}&auto=1` : '';
          return (
            <section key={c.id} className={`rounded-3xl p-3 ${today ? 'bg-emerald-50 ring-2 ring-emerald-400' : 'bg-slate-100/70'}`}>
              <h2 className="mb-2 flex items-center gap-2 px-1 font-display text-lg font-bold text-ink-900">
                {c.name_ar}{today && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">الجلسة المفتوحة</span>}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <Tile big href={`/reception/${c.id}`} icon="reception" title="الاستقبال" sub="نداء المرضى والقائمة" />
                {tv && <Tile href={tv} icon="display" title="شاشة الانتظار" sub="التلفزيون – بالصوت" ext />}
                <Tile href={`/doctor/${c.id}`} icon="doctor" title="رسائل الطبيب" sub="للمساعد – نص وصوت" />
                {BOOKING_PAGES[c.id] && <Tile href={BOOKING_PAGES[c.id]} icon="reception" title="جدول الحجز" sub="الحجز الإلكتروني" ext />}
                <Tile href={`/summary/${c.id}`} icon="reception" title="ملخص اليوم" sub="تقرير الجلسة" />
              </div>
            </section>);
        })}
        {admin && (
          <section className="grid gap-2 sm:grid-cols-2">
            <Tile href="/admin" icon="admin" title="الإدارة" sub="الإعدادات، المستخدمون، الروابط، الصوت" />
            <Tile href="/voicetest" icon="display" title="اختبار الصوت" sub="جرس وصوت شاكر" />
          </section>)}
      </div>
    </main>
  );
}
