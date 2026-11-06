'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n';

export default function Home() {
  const { t, toggle, lang } = useLang();
  const [d, setD] = useState<any>(null);
  useEffect(() => { fetch('/api/clinics').then((r) => r.json()).then(setD); }, []);
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-ink-900">{t('app')}</h1>
          <p className="text-sm text-slate-500">{d?.session?.name}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={toggle}>{lang === 'ar' ? 'EN' : 'ع'}</button>
          {d?.session?.role === 'admin' && <Link className="btn-ghost text-sm" href="/admin">{t('admin')}</Link>}
          <button className="btn-ghost text-sm" onClick={logout}>{t('logout')}</button>
        </div>
      </header>
      {d?.demo && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200">{t('demo')}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {d?.clinics?.map((c: any) => (
          <div key={c.id} className="card p-5">
            <h2 className="font-display text-lg font-bold text-ink-900">{lang === 'ar' ? c.name_ar : c.name_en}</h2>
            <div className="mt-4 grid gap-2">
              <Link className="btn-primary py-3" href={`/reception/${c.id}`}>{t('reception')}</Link>
              <Link className="btn-ghost" href={`/summary/${c.id}`}>{t('summary')}</Link>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-slate-400">رابط شاشة الانتظار متاح للمسؤول من صفحة الإعدادات ← الروابط</p>
    </main>
  );
}
