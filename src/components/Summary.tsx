'use client';
import { useEffect, useState } from 'react';
import { PAY, PAY_ORDER, payOf, isKashf, payTotals, egp } from '@/lib/payment';
import ClosingCard from './ClosingCard';
import Link from 'next/link';
import { STATUS_AR, type Status } from '@/lib/config';
import { toArabicDigits } from '@/lib/arabic';
import { fmtDate, fmtTime12, fmtTs12, cairoDate } from '@/lib/time';

const KIND: Record<string, string> = { call: 'نداء', recall: 'إعادة نداء مريض', repeat: 'تكرار' };

export default function Summary({ clinic }: { clinic: string }) {
  const [date, setDate] = useState(cairoDate());
  const [d, setD] = useState<any>(null);
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);
  const [n, setN] = useState(0);                              // reload counter
  useEffect(() => { const q = new URLSearchParams(location.search).get('date'); if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) setDate(q); }, []);   // link from the monthly report
  useEffect(() => {
    fetch(`/api/admin/summary?clinic=${clinic}&date=${date}`).then((r) => r.json()).then(setD);
    fetch('/api/clinics').then((r) => r.json()).then((j) => { setName(j.clinics?.find((c: any) => c.id === clinic)?.name_ar ?? clinic); setAdmin(j.session?.role === 'admin'); });
  }, [clinic, date, n]);
  const clearDay = async () => {
    if (!confirm(`مسح كل بيانات ${name} ليوم ${fmtDate(date, true)}؟\n(المرضى، النداءات، سجل التعديلات)\n\nلا يمكن التراجع.\nالمرضى الموجودون في أوراكل بنفس التاريخ سيعودون مع المزامنة التالية.`)) return;
    if (prompt('للتأكيد اكتب: مسح') !== 'مسح') return;
    const r = await fetch(`/api/admin/summary?clinic=${clinic}&date=${date}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    alert(j.ok ? 'تم المسح ✓' : `تعذّر المسح: ${j.detail || j.error || r.status}`);
    setN((x) => x + 1);
  };
  // admin: change the payment of any day (e.g. a past Toukh day) – instant, logged, closing numbers follow
  const setPay = async (e: any, m: string) => {
    const prev = e.payment;
    setD((x: any) => ({ ...x, entries: x.entries.map((r: any) => (r.id === e.id ? { ...r, payment: m } : r)) }));
    const j = await (await fetch('/api/payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic, entry_id: e.id, method: m }) })).json().catch(() => ({}));
    if (!j.ok) { alert(`تعذّر الحفظ: ${j.detail || j.error || ''}`); setD((x: any) => ({ ...x, entries: x.entries.map((r: any) => (r.id === e.id ? { ...r, payment: prev } : r)) })); }
    else setN((x) => x + 1);                                   // reload → payment log + totals
  };
  const A = toArabicDigits;
  const cards: [string, number | string][] = d ? [
    ['إجمالي', d.total], ['تم الكشف', d.by.done ?? 0], ['منتظر', d.by.waiting ?? 0], ['غائب', d.by.absent ?? 0],
    ['مؤجل', d.by.postponed ?? 0], ['ملغي', d.by.cancelled ?? 0], ['بدون حجز', d.walkins], ['متوسط الكشف (دقيقة)', d.avg_consult ?? '—'],
    ['استراحات الطبيب', (() => { const b = withBreaks(sortByEntry(d.entries)).filter((r: any) => r.brk); return b.length ? `${b.length} – ${b.reduce((t: number, r: any) => t + r.brk.min, 0)} دقيقة` : '0'; })()],
  ] : [];
  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2">
        <Link href={`/reception/${clinic}`} className="btn-ghost text-sm">→ الاستقبال</Link>
        <input type="date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        {admin && <button className="btn-ghost ms-auto text-sm text-rose-700" onClick={clearDay} title="مسح بيانات التجربة لهذا اليوم">🗑 مسح بيانات اليوم</button>}
        <button className={`btn-primary text-sm ${admin ? '' : 'ms-auto'}`} onClick={() => print()}>🖨 طباعة A4</button>
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
        {d.role === 'admin' && (() => {          // money: كشف only (استشارة free) – admin only
          const T = payTotals(d.entries, d.fee ?? 0);
          const setFee = async () => {
            const v = prompt('سعر الكشف (جنيه):', String(d.fee || '')); if (v === null) return;
            const j = await (await fetch('/api/fee', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic, fee: v.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))) }) })).json().catch(() => ({}));
            if (j.ok) setN((x) => x + 1); else alert('سعر غير صحيح');
          };
          const pe = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as any;
          return (
            <section className="mb-5 break-inside-avoid overflow-hidden rounded-xl border-2 border-emerald-700">
              <div className="flex items-center justify-between bg-emerald-700 px-3 py-1.5 text-white" style={pe}>
                <b>💰 الحساب – الكشف فقط (الاستشارة مجانية)</b>
                <button onClick={setFee} className="num rounded bg-white/15 px-2 py-0.5 text-xs font-bold print:bg-transparent">سعر الكشف: {T.fee ? egp(T.fee) : 'اضغط للتحديد'}</button>
              </div>
              <table className="w-full border-collapse text-[13px]">
                <tbody>
                  {([['fawry', T.fawry, T.fawrySum], ['instapay', T.instapay, T.instapaySum], ['refund', T.refund, T.refundSum]] as const).map(([m, c, sum]) => (
                    <tr key={m} className="border-b border-slate-200">
                      <td className="px-3 py-1"><span className={`inline-block rounded px-2 py-px text-[12px] font-black ${PAY[m].cls}`} style={pe}>{PAY[m].icon} {PAY[m].ar}</span></td>
                      <td className="num px-3 py-1">{A(c)} كشف</td>
                      <td className={`num px-3 py-1 text-end font-bold ${m === 'refund' ? 'text-rose-700' : ''}`}>{T.fee ? (m === 'refund' ? 'مُرتجع ' : '') + egp(sum) : '—'}</td>
                    </tr>))}
                  <tr className="bg-emerald-50" style={pe}>
                    <td className="px-3 py-1.5 font-black">الإجمالي النهائي</td>
                    <td className="num px-3 py-1.5 font-bold">{A(T.paid)} كشف مدفوع</td>
                    <td className="num px-3 py-1.5 text-end text-lg font-black text-emerald-800">{T.fee ? egp(T.total) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </section>);
        })()}
        {d.role === 'admin' && <ClosingCard clinic={clinic} date={date} T={payTotals(d.entries, d.fee ?? 0)} />}
        <table className="w-full border-collapse text-[12px]">
          <thead><tr className="bg-slate-100 text-start">
            {['الرقم', 'الموعد', 'الاسم', 'النوع', 'الدفع', 'الحالة', 'النداء', 'الدخول', 'الانتهاء', 'المدة (من النداء)'].map((h) => <th key={h} className="border border-slate-200 px-2 py-1 text-start">{h}</th>)}
          </tr></thead>
          <tbody>{withBreaks(sortByEntry(d.entries)).map((row: any, i: number) => row.brk ? (
            <tr key={'b' + i} className="break-inside-avoid bg-amber-50">
              <td colSpan={10} className="border border-amber-200 px-2 py-1 text-center font-bold text-amber-800">
                ☕ استراحة الطبيب – {minutesAr(row.brk.min, A)} <span className="num font-normal">({fmtTs12(row.brk.from)} ← {fmtTs12(row.brk.to)})</span>
              </td>
            </tr>) : ((e: any) => (
            <tr key={i} className="break-inside-avoid">
              <td className="num border border-slate-200 px-2 py-1 font-bold">{e.queue_number ? A(e.queue_number) : '—'}{e.priority ? ' ⚑' : ''}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTime12(e.appt_time)}</td>
              <td className="border border-slate-200 px-2 py-1">{e.patient_name}{e.source === 'walkin' ? ' (بدون حجز)' : ''}</td>
              <td className="border border-slate-200 px-1 py-1 text-center">{e.procedure ? (
                <span className={`inline-block rounded px-2 py-px text-[11px] font-black text-white ${/كشف/.test(e.procedure) ? 'bg-[#6b3e26]' : /استشار/.test(e.procedure) ? 'bg-sky-500' : 'bg-slate-500'}`}
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as any}>{e.procedure}</span>) : ''}</td>
              <td className="border border-slate-200 px-1 py-1 text-center">{isKashf(e.procedure) ? (<>
                {d.role === 'admin' && <select value={payOf(e.payment)} onChange={(ev) => setPay(e, ev.target.value)} title="تعديل طريقة الدفع لهذا اليوم"
                  className={`cursor-pointer appearance-none rounded px-1.5 py-px text-center text-[11px] font-black outline-none print:hidden ${PAY[payOf(e.payment)].cls}`}>
                  {PAY_ORDER.map((m) => <option key={m} value={m} className="bg-white text-ink-900">{PAY[m].ar}</option>)}
                </select>}
                <span className={`${d.role === 'admin' ? 'hidden print:inline-block' : 'inline-block'} whitespace-nowrap rounded px-1.5 py-px text-[11px] font-black ${PAY[payOf(e.payment)].cls}`}
                  style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as any}>{PAY[payOf(e.payment)].ar}</span></>) : <span className="text-[11px] text-slate-400">مجاني</span>}</td>
              <td className="border border-slate-200 px-2 py-1">{STATUS_AR[e.status as Status]}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTs12(e.called_at)}{e.called_count > 1 ? ` ×${A(e.called_count)}` : ''}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTs12(e.in_room_at)}</td>
              <td className="num border border-slate-200 px-2 py-1">{fmtTs12(e.done_at)}</td>
              <td className="num border border-slate-200 px-2 py-1">{e.done_at && (e.called_at || e.in_room_at) ? minutesAr(Math.round((+new Date(e.done_at) - +new Date(e.called_at || e.in_room_at)) / 60000), A) : ''}</td>
            </tr>))(row.e))}</tbody>
        </table>
        {d.role === 'admin' && (d.payment_log?.length ?? 0) > 0 && (<>
          <h2 className="mb-2 mt-6 font-bold text-ink-900">سجل تغييرات الدفع</h2>
          <table className="w-full border-collapse text-[12px]">
            <thead><tr className="bg-slate-100">{['الوقت', 'المريض', 'من', 'إلى', 'بواسطة'].map((h) => <th key={h} className="border border-slate-200 px-2 py-1 text-start">{h}</th>)}</tr></thead>
            <tbody>{d.payment_log.map((l: any) => (
              <tr key={l.id} className={`break-inside-avoid ${l.to_method === 'refund' ? 'bg-rose-50' : ''}`}>
                <td className="num border border-slate-200 px-2 py-1">{fmtTs12(l.created_at)}</td>
                <td className="border border-slate-200 px-2 py-1">{l.patient_name}{l.patient_code ? <span className="num text-slate-500"> ({l.patient_code})</span> : null}</td>
                <td className="border border-slate-200 px-2 py-1">{PAY[payOf(l.from_method)].ar}</td>
                <td className="border border-slate-200 px-2 py-1 font-bold">{PAY[payOf(l.to_method)].ar}</td>
                <td className="border border-slate-200 px-2 py-1">{l.actor}{l.actor_role === 'admin' ? ' (الطبيب)' : ''}</td>
              </tr>))}</tbody>
          </table>
        </>)}
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

// order of entering the room (works across midnight – full timestamps); not entered yet → after, by call time / number
function sortByEntry(list: any[]) {
  const t = (x: any) => (x ? +new Date(x) : Infinity);
  return [...list].sort((a, b) => t(a.in_room_at) - t(b.in_room_at) || t(a.called_at) - t(b.called_at) || (a.queue_number ?? 1e9) - (b.queue_number ?? 1e9));
}

// Arabic minutes: دقيقة / دقيقتان / ٣–١٠ دقائق / ١١+ دقيقة
function minutesAr(n: number, A: (v: any) => string): string {
  if (n < 1) return 'أقل من دقيقة';
  if (n === 1) return 'دقيقة';
  if (n === 2) return 'دقيقتان';
  return `${A(n)} ${n <= 10 ? 'دقائق' : 'دقيقة'}`;
}

// a gap of more than 10 minutes between one patient leaving and the next entering = doctor's break
function withBreaks(list: any[]) {
  const out: any[] = [];
  let lastDone: string | null = null;
  for (const e of list) {
    if (e.in_room_at && lastDone) {
      const min = Math.round((+new Date(e.in_room_at) - +new Date(lastDone)) / 60000);
      if (min > 10) out.push({ brk: { min, from: lastDone, to: e.in_room_at } });
    }
    out.push({ e });
    if (e.done_at) lastDone = e.done_at;
  }
  return out;
}
