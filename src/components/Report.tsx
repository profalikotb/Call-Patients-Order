'use client';
// «التقرير الشهري» (admin): revenue, expenses, net, cases and consultation time per clinic – vs the previous month.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { egp } from '@/lib/payment';
import { cairoDate, fmtDate } from '@/lib/time';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const mName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const DOW = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const pe = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as any;
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');

export default function Report() {
  const [month, setMonth] = useState(cairoDate().slice(0, 7));
  const [clinic, setClinic] = useState<string>('all');
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setD(null); setErr('');
    fetch(`/api/admin/report?month=${month}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j.ok) setD(j); else if (j.error === 'unauthorized') location.href = '/login?next=/report'; else setErr(j.error === 'forbidden' ? 'هذه الصفحة للطبيب فقط' : String(j.detail || j.error));
    }).catch((e) => setErr(String(e)));
  }, [month]);

  const view = useMemo(() => {
    if (!d) return null;
    const days = d.days.filter((x: any) => clinic === 'all' || x.clinic === clinic);
    const t = clinic === 'all' ? d.all : d.by_clinic[clinic] ?? { now: null, prev: null };
    return { days, now: t.now, prev: t.prev };
  }, [d, clinic]);
  const cName = (id: string) => d?.clinics.find((c: any) => c.id === id)?.name ?? id;
  const shift = (k: number) => { const [y, m] = month.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(x.toISOString().slice(0, 7)); };

  const Delta = ({ now, prev, money, invert }: { now: number; prev: number; money?: boolean; invert?: boolean }) => {
    if (!prev) return <span className="text-[11px] opacity-60">—</span>;
    const p = Math.round(((now - prev) / Math.abs(prev)) * 100);
    const good = invert ? p <= 0 : p >= 0;
    return <span className={`num inline-block rounded bg-white/90 px-1 text-[11px] font-bold ${p === 0 ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-rose-600'}`}>{p > 0 ? '▲' : p < 0 ? '▼' : '●'} {Math.abs(p)}% <span className="font-normal text-slate-400">({money ? n0(prev) : prev})</span></span>;
  };
  const Kpi = ({ label, v, pv, money, invert, cls }: any) => (
    <div className={`rounded-xl p-3 ring-1 ring-slate-200 ${cls ?? 'bg-white'}`} style={pe}>
      <div className="text-[11px] font-semibold opacity-80">{label}</div>
      <div className="num text-2xl font-black">{money ? egp(v ?? 0) : v ?? '—'}</div>
      {pv !== undefined && <Delta now={v ?? 0} prev={pv ?? 0} money={money} invert={invert} />}
    </div>
  );

  const maxNet = Math.max(1, ...(view?.days ?? []).map((x: any) => Math.abs(x.net)));
  return (
    <main className="mx-auto max-w-[210mm] bg-white p-5 print:p-0">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link href="/admin" className="btn-ghost text-sm">→ الإعدادات</Link>
        <button className="btn-ghost px-3 text-sm" onClick={() => shift(-1)} title="الشهر السابق">›</button>
        <input type="month" className="input w-auto" value={month} max={cairoDate().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className="btn-ghost px-3 text-sm" onClick={() => shift(1)} disabled={month >= cairoDate().slice(0, 7)} title="الشهر التالي">‹</button>
        <button className="btn-primary ms-auto text-sm" onClick={() => print()}>🖨 طباعة A4</button>
      </div>
      <header className="mb-3 flex items-end justify-between border-b-2 border-ink-900 pb-2">
        <div>
          <h1 className="font-display text-xl font-extrabold text-ink-900">التقرير الشهري – {mName(month)}</h1>
          <p className="text-xs text-slate-500">عيادة أ.د. على قطب على – أستاذ جراحة المخ والأعصاب · مقارنة بشهر {d ? mName(d.prev_month) : ''}</p>
        </div>
        <div className="num text-sm font-bold text-slate-500">{fmtDate(cairoDate(), true)}</div>
      </header>
      {err && <p className="rounded-lg bg-rose-50 p-3 text-rose-700">{err}</p>}
      {!d && !err && <p className="text-slate-500">…</p>}
      {view && (<>
        <nav className="no-print mb-3 flex flex-wrap gap-1.5">
          {[['all', 'كل العيادات'], ...d.clinics.filter((c: any) => d.by_clinic[c.id]).map((c: any) => [c.id, c.name])].map(([id, nm]) => (
            <button key={id} onClick={() => setClinic(id)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${clinic === id ? 'bg-ink-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{nm}</button>))}
        </nav>
        {clinic !== 'all' && <div className="mb-2 hidden font-bold print:block">{cName(clinic)}</div>}
        {!view.now?.days ? <p className="rounded-lg bg-slate-50 p-6 text-center text-slate-500">لا توجد بيانات لهذا الشهر</p> : (<>
          <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="💰 صافي الكشوفات" v={view.now.revenue} pv={view.prev?.revenue} money cls="bg-emerald-700 text-white" />
            <Kpi label="🧾 المصروفات" v={view.now.expenses} pv={view.prev?.expenses} money invert cls="bg-rose-50 text-rose-900" />
            <Kpi label="✅ الصافي النهائي" v={view.now.net} pv={view.prev?.net} money cls="bg-yellow-200 text-ink-950" />
            <Kpi label="📅 أيام العمل" v={view.now.days} pv={view.prev?.days} />
            <Kpi label="كشف" v={view.now.kashf} pv={view.prev?.kashf} cls="bg-[#6b3e26] text-white" />
            <Kpi label="استشارة" v={view.now.istishara} pv={view.prev?.istishara} cls="bg-sky-500 text-white" />
            <Kpi label="↩ كشف مُرتجع" v={view.now.refund} pv={view.prev?.refund} invert />
            <Kpi label="⏱ متوسط الكشف (دقيقة)" v={view.now.consult_min} />
          </section>
          <section className="mb-3 grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg bg-emerald-50 p-2 text-center" style={pe}>💵 كاش <b className="num">{view.now.cash}</b></div>
            <div className="rounded-lg bg-violet-50 p-2 text-center" style={pe}>📱 انستاباي <b className="num">{view.now.instapay}</b></div>
            <div className="rounded-lg bg-slate-50 p-2 text-center">متوسط المرضى/يوم <b className="num">{view.now.days ? Math.round((view.now.patients / view.now.days) * 10) / 10 : 0}</b></div>
          </section>
          {view.now.unclosed > 0 && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">⚠ {view.now.unclosed} يوم بدون «تقفيل» محفوظ – إيرادها محسوب من النظام والمصروفات = 0. افتح ملخص اليوم واحفظ التقفيل.</p>}

          <h2 className="mb-1 font-bold text-ink-900">الصافي اليومي</h2>
          <div className="mb-4 flex h-28 items-end gap-[3px] rounded-xl bg-slate-50 p-2" style={pe}>
            {view.days.map((x: any) => (
              <div key={x.clinic + x.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${fmtDate(x.date, true)} ${cName(x.clinic)}: ${egp(x.net)}`}>
                <div className={`w-full rounded-t ${x.net < 0 ? 'bg-rose-500' : x.closed ? 'bg-emerald-600' : 'bg-emerald-300'}`} style={{ height: `${Math.max(3, (Math.abs(x.net) / maxNet) * 100)}%`, ...pe }} />
                <div className="num mt-0.5 text-center text-[9px] text-slate-500">{Number(x.date.slice(8))}</div>
              </div>))}
          </div>

          <table className="w-full border-collapse text-[11.5px]">
            <thead><tr className="bg-slate-100">{['اليوم', ...(clinic === 'all' ? ['العيادة'] : []), 'مرضى', 'كشف', 'استشارة', 'كاش', 'انستا', 'مرتجع', 'الإيراد', 'المصروفات', 'الصافي', 'متوسط'].map((h) => <th key={h} className="border border-slate-200 px-1.5 py-1 text-start">{h}</th>)}</tr></thead>
            <tbody>{view.days.map((x: any) => (
              <tr key={x.clinic + x.date} className="break-inside-avoid">
                <td className="num border border-slate-200 px-1.5 py-1"><Link className="hover:underline" href={`/summary/${x.clinic}?date=${x.date}`}>{DOW[new Date(x.date + 'T12:00:00Z').getUTCDay()]} {x.date.slice(8)}/{x.date.slice(5, 7)}</Link>{!x.closed && <span className="text-amber-600" title="بدون تقفيل"> ⚠</span>}</td>
                {clinic === 'all' && <td className="border border-slate-200 px-1.5 py-1">{cName(x.clinic)}</td>}
                <td className="num border border-slate-200 px-1.5 py-1">{x.patients}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{x.kashf}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{x.istishara}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{x.cash}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{x.instapay}</td>
                <td className="num border border-slate-200 px-1.5 py-1 text-rose-600">{x.refund || ''}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{n0(x.revenue)}</td>
                <td className="num border border-slate-200 px-1.5 py-1 text-rose-700">{x.expenses ? n0(x.expenses) : ''}</td>
                <td className={`num border border-slate-200 px-1.5 py-1 font-bold ${x.net < 0 ? 'text-rose-700' : ''}`}>{n0(x.net)}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{x.consult_min ?? ''}</td>
              </tr>))}
              <tr className="bg-yellow-100 font-black" style={pe}>
                <td className="border border-slate-200 px-1.5 py-1" colSpan={clinic === 'all' ? 2 : 1}>الإجمالي</td>
                {['patients', 'kashf', 'istishara', 'cash', 'instapay', 'refund'].map((k) => <td key={k} className="num border border-slate-200 px-1.5 py-1">{view.now[k]}</td>)}
                <td className="num border border-slate-200 px-1.5 py-1">{n0(view.now.revenue)}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{n0(view.now.expenses)}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{n0(view.now.net)}</td>
                <td className="num border border-slate-200 px-1.5 py-1">{view.now.consult_min ?? ''}</td>
              </tr>
            </tbody>
          </table>
        </>)}
      </>)}
    </main>
  );
}
