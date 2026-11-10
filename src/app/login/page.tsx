'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLang } from '@/lib/i18n';

function LoginInner() {
  const { t, toggle, lang } = useLang();
  const r = useRouter();
  const q = useSearchParams();
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  // a plain text box shown as dots is never offered for saving by Edge/Chrome; random names stop old autofill
  const [fieldId] = useState(() => Math.random().toString(36).slice(2, 8));
  const [masked, setMasked] = useState(false);
  useEffect(() => { try { setMasked(CSS.supports('-webkit-text-security', 'disc')); } catch {} }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
      if (res.ok) { const n = q.get('next') || '/'; r.replace(n.startsWith('/') && !n.startsWith('//') ? n : '/'); return; }
      const j = await res.json().catch(() => ({} as any));
      // 401 = wrong username/password; anything else = server configuration problem → show the real reason
      if (res.status === 401) setErr(t('badLogin'));
      else setErr(`خطأ في إعدادات الخادم (${res.status}): ${j.detail || j.error || 'unknown'} — افتح /api/health`);
    } catch (e: any) {
      setErr(`تعذر الاتصال بالخادم: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-dvh grid place-items-center bg-gradient-to-br from-ink-950 via-ink-900 to-ink-800 p-4">
      <form onSubmit={submit} autoComplete="off" className="w-full max-w-sm rounded-3xl bg-white/95 p-7 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-ink-900 text-2xl font-black text-gold-400 num">١٢</div>
          <h1 className="font-display text-xl font-extrabold text-ink-900">{t('app')}</h1>
          <p className="mt-1 text-xs text-slate-500">عيادة أ.د. على قطب على – جراحة المخ والأعصاب</p>
        </div>
        <label className="label">{t('username')}</label>
        {/* no autofill / no saved passwords: the browser must not fill the login on shared clinic PCs */}
        <input className="input mb-3" dir="ltr" name={`u_${fieldId}`} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
          data-lpignore="true" data-1p-ignore value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label className="label">{t('password')}</label>
        <input className="input mb-4" dir="ltr" name={`p_${fieldId}`} autoComplete="off" data-lpignore="true" data-1p-ignore
          type={masked ? 'text' : 'password'} style={masked ? ({ WebkitTextSecurity: 'disc' } as any) : undefined}
          value={p} onChange={(e) => setP(e.target.value)} />
        {err && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <button className="btn-primary w-full py-3" disabled={busy || !u || !p}>{busy ? '…' : t('enter')}</button>
        <button type="button" onClick={toggle} className="mt-4 w-full text-center text-xs text-slate-400">{lang === 'ar' ? 'English' : 'العربية'}</button>
      </form>
    </main>
  );
}
export default function Login() { return <Suspense><LoginInner /></Suspense>; }
