'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { STATUS_AR, type Status } from '@/lib/config';
import { toArabicDigits } from '@/lib/arabic';
import { fmtDate, fmtTime12, fmtTs12, cairoDate } from '@/lib/time';

const KIND: Record<string, string> = { call: 'نداء', recall: 'إعادة نداء مريض', repeat: 'تكرار' };

export default function Summary({ clinic }: { clinic: string }) {
  const [date, setDate] = useState(cairoDate());
  const [d, setD] = useState<any>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    fetch(`/api/admin/summary?clinic=${clinic}&date=${date}`).then((r) => r.json()).then(setD);
    fetch('/api/clinics').then((r) => r.json()).then((j) => setName(j.clinics?.find((c: any) => c.id === clinic)?.name_ar ?? clinic));
  }, [clinic, date]);
  const A = toArabicDigits;
  const cards: [string, number | string][] = d ? [
    ['إجمالي', d.total], ['تم الكشف', d.by.done ?? 0], ['منتظر', d.by.waiting ?? 0], ['غائب', d.by.absent ?? 0],
    ['مؤجل', d.by.postponed ?? 0], ['ملغي', d.by.cancelled ?? 0], ['بدون حجز', d.walkins], ['متوسط الكشف (د)', d.avg_consult ?? '—'],
  ] : [];
  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2">
        <Link href={`/reception/${clinic}`} className="btn-ghost text-sm">→ الاستقبال</Link>
        <input type="date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn-primary ms-auto text-sm" onClick={() => print()}>🖨 طباعة A4</button>
      </div>
      <header className="mb-4 flex items-end justify-between border-b-2 border-ink-900 pb-2">
        <div>
          <h1 className="font-display text-xl font-extrabold text-ink-900">ملخص اليوم – {name}</h1>
          <p className="text-xs text-slate-500">عيادة أ.د. على قطب على – أستاذ جراحة المخ والأعصاب</p>
        </div>
        <div className="num text-lg font-bold">{fmtDate(date, true)}</div>
      </header>
      {!d ? <p>…</p> : (<>
        <section className="mb-5 grid grid-cols-4 gap-2">
          {cards.map(([k, v]) => (
            <div key={k} className="rounded-xl border border-slate-200 p-2.5">
              <div className="text-[11px] text-slate-500">{k}</div>
              <div className="num text-2xl font-extrabold text-ink-900">{typeof v === 'number' ? A(v) : A(String(v))}</div>
            </div>))}
        </section>
        <table className="w-full border-collapse text-[12px]">
          <thead><tr className="bg-slate-100 text-start">
            {['الرقم', 'الموعد', 'الاسم', 'الحالة', 'النداء', 'الدخول', 'الانتهاء', 'المدة'].map((h) => <th key={h} className="border border-slate-200 px-2 py-1 text-start">{h}</th>)}
          </tr></thead>
          <tbody>{d.entries.map((e: any, i: number) => (
            <tr key={i} className="break-inside-avoid">
              <td className="num border border-slate-200 px-2 py-1 font-bold">{e.queue_number ? A(e.queue_number) : '—'}{e.priority ? ' ⚑' : ''}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTime12(e.appt_time)}</td>
              <td className="border border-slate-200 px-2 py-1">{e.patient_name}{e.source === 'walkin' ? ' (بدون حجز)' : ''}</td>
              <td className="border border-slate-200 px-2 py-1">{STATUS_AR[e.status as Status]}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTs12(e.called_at)}{e.called_count > 1 ? ` ×${A(e.called_count)}` : ''}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTs12(e.in_room_at)}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTs12(e.done_at)}</td>
              <td className="num border border-slate-200 px-2 py-1">{e.done_at && e.in_room_at ? A(Math.round((+new Date(e.done_at) - +new Date(e.in_room_at)) / 60000)) + ' د' : ''}</td>
            </tr>))}</tbody>
        </table>
        <h2 className="mb-2 mt-6 font-bold text-ink-900">سجل النداءات</h2>
        <div className="columns-2 gap-4 text-[11px]">
          {d.announcements.map((a: any) => (
            <div key={a.seq} className="break-inside-avoid border-b border-slate-100 py-0.5">
              <span className="num">{fmtTs12(a.created_at)}</span> · رقم <b className="num">{A(a.queue_number)}</b> · {KIND[a.kind]}
              {a.silent ? ' (صامت)' : a.played_at ? ' ✓' : ' (لم يُشغَّل)'} · {a.created_by}
            </div>))}
        </div>
        <h2 className="mb-2 mt-6 font-bold text-ink-900 no-print">سجل التعديلات</h2>
        <div className="no-print text-[11px]">
          {d.audit.map((a: any) => (
            <div key={a.id} className={`border-b border-slate-100 py-0.5 ${a.undone ? 'line-through opacity-50' : ''}`}>
              <span className="num">{fmtTs12(a.created_at)}</span> · {a.action} · {a.actor} {a.result?.number ? `· رقم ${A(a.result.number)}` : ''}
            </div>))}
        </div>
      </>)}
    </main>
  );
}
