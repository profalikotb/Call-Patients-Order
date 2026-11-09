'use client';
// Doctor → assistant: big one-tap buttons instead of the local phone. Works on PC, tablet or mobile.
import { useCallback, useEffect, useState } from 'react';

export const DOCTOR_PRESETS: [string, string][] = [
  ['📞', 'تعال للغرفة من فضلك'],
  ['➡️', 'أدخل المريض التالي'],
  ['✋', 'انتظر قليلاً قبل إدخال التالي'],
  ['📁', 'أحضر ملف / أشعة المريض الحالي'],
  ['🖨️', 'اطبع الروشتة'],
  ['🔁', 'أعد نداء المريض'],
  ['💧', 'أحضر ماء من فضلك'],
  ['⏸️', 'استراحة ١٠ دقائق – لا تدخل أحداً'],
];

export default function DoctorPad({ clinic }: { clinic: string }) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    try { const j = await (await fetch(`/api/staff-msg?clinic=${clinic}`, { cache: 'no-store' })).json(); if (j.ok) setMsgs(j.messages); } catch {}
  }, [clinic]);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  const send = async (body: string) => {
    if (!body.trim()) return;
    setNote('…');
    const j = await (await fetch('/api/staff-msg', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clinic, text: body }) })).json().catch(() => ({ ok: false, error: 'network' }));
    setNote(j.ok ? '✓ أُرسلت إلى الاستقبال' : `خطأ: ${j.detail || j.error}`); setText(''); load();
    setTimeout(() => setNote(''), 4000);
  };
  const time = (t: string) => new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  return (
    <main dir="rtl" className="mx-auto min-h-dvh max-w-3xl space-y-4 bg-slate-50 p-4">
      <h1 className="font-display text-2xl font-black text-ink-900">رسائل سريعة للمساعد</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DOCTOR_PRESETS.map(([icon, label]) => (
          <button key={label} onClick={() => send(label)}
            className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-2xl bg-white p-3 text-center text-sm font-bold text-ink-900 shadow-sm ring-1 ring-slate-200 active:scale-95 hover:bg-amber-50">
            <span className="text-3xl">{icon}</span>{label}</button>))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="input flex-1" placeholder="رسالة أخرى…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary px-5">إرسال</button>
      </form>
      {note && <div className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white">{note}</div>}
      <section className="card divide-y divide-slate-100">
        <div className="px-4 py-2 text-xs font-semibold text-slate-500">آخر الرسائل</div>
        {msgs.length === 0 && <div className="p-4 text-sm text-slate-400">لا توجد رسائل</div>}
        {msgs.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="font-semibold">{m.body}</span>
            <span className="shrink-0 text-xs">{time(m.created_at)} · {m.ack_at
              ? <span className="font-bold text-emerald-600">✓ قرأها {m.ack_by ?? ''}</span>
              : <span className="font-bold text-amber-600">⏳ لم تُقرأ</span>}</span>
          </div>))}
      </section>
    </main>
  );
}
