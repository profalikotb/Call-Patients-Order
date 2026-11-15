'use client';
// «تقفيل العيادة» – the Access CASES form inside the day summary (admin only).
// Cases / refunds / fee come from the app automatically; expenses are typed; Grand Net + Daily Report are calculated.
import { useEffect, useMemo, useState } from 'react';
import { EXPENSES, calcClosing, closingNum } from '@/lib/closing';
import { egp, type PayTotals } from '@/lib/payment';

const pe = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as any;
const dd = (iso: string) => iso.split('-').reverse().join('/');

export default function ClosingCard({ clinic, date, T }: { clinic: string; date: string; T: PayTotals }) {
  const auto = useMemo(() => ({ no_cases: T.fawry + T.instapay + T.refund, fees_back: T.refund, fees: T.fee }), [T.fawry, T.instapay, T.refund, T.fee]);
  const [c, setC] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState<{ by?: string; at?: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let off = false;
    setC({}); setSaved(null); setDirty(false); setMsg('');
    fetch(`/api/closing?clinic=${clinic}&date=${date}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (off) return;
      if (!j.ok) { setMsg(String(j.detail || j.error)); setC({ ...auto }); return; }
      if (j.closing) { setC(j.closing.items); setSaved({ by: j.closing.updated_by, at: j.closing.updated_at }); }
      else setC({ ...auto });
    }).catch(() => setC({ ...auto }));
    return () => { off = true; };
  }, [clinic, date]); // eslint-disable-line

  const r = calcClosing(c, dd(date));
  const set = (k: string, v: string) => { setC({ ...c, [k]: v }); setDirty(true); };
  const differs = saved && (closingNum(c.no_cases) !== auto.no_cases || closingNum(c.fees_back) !== auto.fees_back || closingNum(c.fees) !== auto.fees);

  const save = async () => {
    setMsg('…');
    const j = await (await fetch('/api/closing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic, date, items: c }) })).json().catch(() => ({}));
    if (j.ok) { setDirty(false); setSaved({ by: 'أنت', at: new Date().toISOString() }); setMsg('✓ تم حفظ التقفيل'); setTimeout(() => setMsg(''), 3000); }
    else setMsg(`تعذّر الحفظ: ${j.detail || j.error || ''}`);
  };
  const copy = () => { try { navigator.clipboard.writeText(r.report); setMsg('📋 تم نسخ التقرير'); setTimeout(() => setMsg(''), 2000); } catch {} };

  const Num = (k: string, big?: boolean, ro?: boolean) => (
    <input className={`num w-full rounded-md border px-2 py-1 text-end font-bold outline-none focus:ring-2 focus:ring-emerald-400 print:border-0 ${big ? 'border-amber-300 bg-yellow-200 text-base' : 'border-slate-300 bg-white'} ${ro ? 'bg-slate-100 text-slate-500' : ''}`}
      inputMode="numeric" dir="ltr" readOnly={ro} value={c[k] ?? ''} placeholder="0" onChange={(e) => set(k, e.target.value)} onFocus={(e) => e.target.select()} />
  );
  const Row = (label: string, hint: string, children: any, key?: string) => (
    <label key={key} className="grid grid-cols-[1fr_7.5rem] items-center gap-2 py-0.5"><span className="text-[13px] font-semibold text-ink-900">{label}{hint && <span className="ms-1 text-[10px] font-normal text-slate-400">{hint}</span>}</span>{children}</label>
  );

  return (
    <section className="mb-5 break-inside-avoid overflow-hidden rounded-xl border-2 border-ink-900">
      <div className="flex flex-wrap items-center gap-2 bg-ink-900 px-3 py-1.5 text-white" style={pe}>
        <b>🧾 تقفيل العيادة</b>
        <span className="text-xs text-white/60">{saved ? `محفوظ${saved.by ? ' – ' + saved.by : ''}` : 'لم يُحفظ بعد'}{dirty ? ' · تعديلات غير محفوظة' : ''}</span>
        <span className="ms-auto flex gap-1.5 print:hidden">
          {differs && <button onClick={() => { setC({ ...c, ...auto }); setDirty(true); }} className="rounded bg-amber-400 px-2 py-0.5 text-xs font-bold text-black" title="أرقام النظام تغيرت بعد الحفظ">↻ تحديث من النظام</button>}
          <button onClick={save} className={`rounded px-3 py-0.5 text-xs font-black ${dirty || !saved ? 'bg-emerald-500 text-white' : 'bg-white/15'}`}>💾 حفظ التقفيل</button>
        </span>
      </div>
      <div className="grid gap-x-6 gap-y-1 p-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-black text-emerald-800">الإيراد (الكشف فقط)</div>
          {Row('عدد الحالات', 'No of Cases', Num('no_cases', true))}
          {Row('كشف مُرتجع', 'Fees Back', Num('fees_back', true))}
          {Row('صافي العدد', 'Net Number', <><div className="num rounded-md bg-slate-100 px-2 py-1 text-end font-bold">{r.net_number}</div></>)}
          {Row('سعر الكشف', 'Fees', Num('fees'))}
          {Row('صافي الكشوفات', 'NetFees', <><div className="num rounded-md bg-emerald-50 px-2 py-1 text-end font-black text-emerald-800">{egp(r.net_fees)}</div></>)}
        </div>
        <div>
          <div className="mb-1 text-xs font-black text-rose-700">المصروفات</div>
          {EXPENSES.map(([k, ar, en]) => Row(ar, en, Num(k), k))}
          {closingNum(c.others) !== 0 && <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="بيان «أخرى» (NotesofOther)" value={c.notes_other ?? ''} onChange={(e) => set('notes_other', e.target.value)} />}
          <div className="num mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm font-bold text-rose-700"><span>إجمالي المصروفات</span><span>{egp(r.exp)}</span></div>
        </div>
      </div>
      <div className="px-3 pb-2"><input className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm print:border-0" placeholder="ملاحظات (Notes)" value={c.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="grid items-stretch gap-2 border-t-2 border-ink-900 bg-yellow-200 p-3 sm:grid-cols-[auto_1fr]" style={pe}>
        <div className="text-center sm:text-start">
          <div className="text-xs font-bold text-ink-800">الصافي النهائي – Grand Net</div>
          <div className={`num text-3xl font-black ${r.grand_net < 0 ? 'text-rose-700' : 'text-ink-950'}`}>{egp(r.grand_net)}</div>
        </div>
        <div className="flex min-w-0 items-start gap-2 rounded-lg bg-white/70 p-2">
          <p dir="ltr" className="num min-w-0 flex-1 break-words text-start text-xs font-semibold text-ink-900">{r.report}</p>
          <button onClick={copy} className="shrink-0 rounded bg-ink-900 px-2 py-1 text-xs font-bold text-white print:hidden" title="نسخ Daily Report">📋</button>
          <a className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-xs font-bold text-white print:hidden" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(r.report)}`} title="إرسال التقرير واتساب">WA</a>
        </div>
      </div>
      {msg && <div className="bg-emerald-50 px-3 py-1 text-center text-xs font-bold text-emerald-800 print:hidden">{msg}</div>}
    </section>
  );
}
