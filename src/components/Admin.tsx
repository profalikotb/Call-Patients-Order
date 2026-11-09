'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FIELD_LABEL_AR, FIELDS, ARABIC_MALE_VOICES, type ClinicSettings, type SheetConfig, type Field } from '@/lib/config';
import { pickVoice } from '@/lib/browserVoice';
import { spellNumber } from '@/lib/numbers';
import { renderAnnouncement } from '@/lib/announce';
import { toArabicDigits } from '@/lib/arabic';

type Tab = 'clinic' | 'voice' | 'sheet' | 'staff' | 'links';
const TABS: [Tab, string][] = [['clinic', 'العيادة والترتيب'], ['voice', 'الصوت والنداء'], ['sheet', 'ربط Google Sheet'], ['staff', 'المستخدمون'], ['links', 'الروابط']];

export default function Admin() {
  const [tab, setTab] = useState<Tab>('clinic');
  const [clinic, setClinic] = useState('heliopolis');
  const [d, setD] = useState<any>(null);
  const [s, setS] = useState<ClinicSettings | null>(null);
  const [sheet, setSheet] = useState<SheetConfig | null>(null);
  const [clinics, setClinics] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const load = async (c = clinic) => {
    const j = await (await fetch(`/api/admin/settings?clinic=${c}`)).json();
    if (!j.ok) { setMsg(j.error === 'forbidden' ? 'هذه الصفحة للمسؤول فقط' : j.error); return; }
    setD(j); setS(j.settings); setSheet(j.sheet); setClinics(j.clinics);
  };
  useEffect(() => { load(clinic); }, [clinic]); // eslint-disable-line
  async function save(body: any, note = 'تم الحفظ') {
    const r = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); setMsg(j.ok ? note : `خطأ: ${j.error} ${j.detail ?? ''}`); setTimeout(() => setMsg(''), 3500);
    if (j.ok) load();
  }
  if (!d || !s || !sheet) return <div className="grid min-h-dvh place-items-center text-slate-500">{msg || '…'}</div>;
  const setV = (k: string, v: any) => setS({ ...s, voice: { ...s.voice, [k]: v } });

  return (
    <div className="min-h-dvh">
      <header className="bg-ink-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="font-display text-lg font-extrabold">الإعدادات</Link>
          <select className="rounded-lg bg-white/10 px-2 py-1 text-sm" value={clinic} onChange={(e) => setClinic(e.target.value)}>
            {clinics.map((c) => <option key={c.id} value={c.id} className="text-ink-900">{c.name_ar}</option>)}
          </select>
          <span className="ms-auto text-xs text-white/60">TTS: Azure {d.tts.azure ? '✓' : '✗'} · ElevenLabs {d.tts.elevenlabs ? '✓' : '✗'} · Sheet: {d.sheet_source}</span>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
          {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-semibold ${tab === k ? 'bg-slate-100 text-ink-900' : 'text-white/70'}`}>{l}</button>)}
        </nav>
      </header>
      {msg && <div className="sticky top-0 z-20 bg-emerald-600 py-1.5 text-center text-sm text-white">{msg}</div>}
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        {tab === 'clinic' && <ClinicTab s={s} setS={setS} clinics={clinics} setClinics={setClinics} clinic={clinic} save={save} />}
        {tab === 'voice' && <VoiceTab s={s} setS={setS} setV={setV} save={save} clinic={clinic} tts={d.tts} />}
        {tab === 'sheet' && <SheetTab sheet={sheet} setSheet={setSheet} save={save} clinics={clinics} />}
        {tab === 'staff' && <StaffTab clinics={clinics} />}
        {tab === 'links' && <LinksTab clinics={clinics} k={d.display_key} />}
      </main>
    </div>
  );
}

function ClinicTab({ s, setS, clinics, setClinics, clinic, save }: any) {
  const c = clinics.find((x: any) => x.id === clinic);
  const setC = (k: string, v: any) => setClinics(clinics.map((x: any) => (x.id === clinic ? { ...x, [k]: v } : x)));
  return (
    <div className="card space-y-5 p-5">
      <div>
        <div className="label">سياسة ترتيب الدور</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {[['time', 'حسب ميعاد الحجز', 'الأرقام تتبع الموعد وتُثبَّت بعد أول نداء'], ['checkin', 'حسب الوصول للاستقبال', 'الرقم يُعطى عند تسجيل الوصول'], ['manual', 'أرقام يدوية', 'الاستقبال يحدد رقم كل مريض']].map(([v, l, h]) => (
            <label key={v} className={`cursor-pointer rounded-xl p-3 ring-1 ${s.policy === v ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white ring-slate-200'}`}>
              <input type="radio" className="hidden" checked={s.policy === v} onChange={() => setS({ ...s, policy: v })} />
              <div className="font-bold">{l}</div><div className="text-xs opacity-70">{h}</div>
            </label>))}
        </div>
        <p className="mt-1 text-xs text-amber-700">تغيير السياسة أثناء اليوم يؤثر على المرضى الجدد فقط – الأرقام المعطاة لا تتغير.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div><label className="label">اسم/رقم غرفة الكشف</label><input className="input" value={s.room_label} onChange={(e) => setS({ ...s, room_label: e.target.value })} /></div>
        <div><label className="label">مدة الكشف الافتراضية (دقيقة) – قبل توفر بيانات اليوم</label><input className="input" type="number" value={s.default_consult_minutes} onChange={(e) => setS({ ...s, default_consult_minutes: +e.target.value })} /></div>
        <div><label className="label">الأرقام على الشاشة</label>
          <select className="input" value={s.display.digits} onChange={(e) => setS({ ...s, display: { ...s.display, digits: e.target.value } })}>
            <option value="arabic">٠١٢٣ عربية</option><option value="western">0123 لاتينية</option></select></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">عنوان الشاشة</label><input className="input" value={s.display.title} onChange={(e) => setS({ ...s, display: { ...s.display, title: e.target.value } })} /></div>
        <div><label className="label">العنوان الفرعي</label><input className="input" value={s.display.subtitle} onChange={(e) => setS({ ...s, display: { ...s.display, subtitle: e.target.value } })} /></div>
        <div className="sm:col-span-2"><label className="label">الشريط السفلي</label><input className="input" value={s.display.ticker} onChange={(e) => setS({ ...s, display: { ...s.display, ticker: e.target.value } })} /></div>
      </div>
      {c && <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label">اسم العيادة</label><input className="input" value={c.name_ar} onChange={(e) => setC('name_ar', e.target.value)} /></div>
        <div><label className="label">قيم عمود «العيادة» في الشيت (مفصولة بفاصلة)</label>
          <input className="input" value={c.sheet_aliases.join('، ')} onChange={(e) => setC('sheet_aliases', e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean))} /></div>
      </div>}
      <button className="btn-primary" onClick={() => save({ settings: s, clinics: [c] })}>حفظ</button>
    </div>
  );
}

function VoiceTab({ s, setS, setV, save, clinic, tts }: any) {
  const [n, setN] = useState(5); const [variant, setVariant] = useState('call'); const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState<{ done: number; total: number; errors: number } | null>(null); const [upto, setUpto] = useState(80);
  const audio = useRef<HTMLAudioElement | null>(null);
  const v = s.voice; const set = v.style === 'formal' ? 'formal' : 'standard';
  async function preview(text?: string) {
    setBusy(true);
    const r = await fetch('/api/tts/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic, n, variant, text, draft: s }) });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const ss = window.speechSynthesis; const vs = ss?.getVoices() ?? [];
      const bv = pickVoice(vs, v.azureVoice);
      if (ss) {
        const u = new SpeechSynthesisUtterance(j.text || text || ''); if (bv) u.voice = bv; u.lang = bv?.lang || 'ar';
        u.rate = Math.min(1.3, Math.max(0.6, 1 + v.rate / 100)); u.pitch = Math.min(1.4, Math.max(0.6, 1 + v.pitch / 50));
        ss.cancel(); ss.speak(u);
      }
      if (!bv) alert('لا يوجد صوت عربي في هذا المتصفح – افتح الصفحة في Microsoft Edge');
      return;
    }
    const url = URL.createObjectURL(await r.blob());
    audio.current?.pause(); audio.current = new Audio(url); audio.current.volume = Math.min(1, v.volume); audio.current.play();
  }
  async function pregenerate() {
    const total = upto * 2; setGen({ done: 0, total, errors: 0 });
    let errors = 0;
    for (let f = 1; f <= upto; f += 15) {
      const r = await fetch('/api/admin/pregenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic, from: f, to: Math.min(upto, f + 14) }) });
      const j = await r.json().catch(() => ({ results: [] }));
      errors += (j.results ?? []).filter((x: any) => x.error).length;
      setGen({ done: Math.min(total, f * 2 + 28), total, errors });
    }
    setGen({ done: total, total, errors });
  }
  const sample = renderAnnouncement(s, n, variant as any, v.includeName ? 'محمد أحمد عبد الله' : null);
  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label">مزود الصوت</label>
            <select className="input" value={v.provider} onChange={(e) => setV('provider', e.target.value)}>
              <option value="azure">Azure Neural (مصري)</option><option value="elevenlabs">ElevenLabs (صوت مخصص)</option></select></div>
          <div><label className="label">الصوت (رجالي)</label>
            <select className="input" value={v.azureVoice} onChange={(e) => setV('azureVoice', e.target.value)}>
              {ARABIC_MALE_VOICES.map((x) => <option key={x.id} value={x.id}>{x.label} ({x.en})</option>)}</select>
            <p className="mt-1 text-[11px] text-slate-500">نفس الصوت على شاشة الانتظار في Microsoft Edge (مجاناً) وفي Azure. «شاكر» هو الصوت المصري الوحيد.</p></div>
          <div><label className="label">ElevenLabs Voice ID (اختياري)</label><input className="input" dir="ltr" value={v.elevenVoiceId} onChange={(e) => setV('elevenVoiceId', e.target.value.trim())} placeholder="اختر صوت رجالي مصري من المكتبة" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-950/5 p-3 text-sm">
          <span className="font-semibold">إعداد سريع:</span>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setS({ ...s, voice: { ...v, azureVoice: 'ar-BH-AliNeural', rate: -8, pitch: -4, volume: 1.2, repeatCount: 2, repeatDelaySec: 3, chime: true, style: 'standard', numberStyle: 'egyptian' } })}>🔊 صوت «علي»</button>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setS({ ...s, voice: { ...v, azureVoice: 'ar-EG-ShakirNeural', rate: -12, pitch: -10, volume: 1.3, repeatCount: 2, repeatDelaySec: 3, chime: true, style: 'standard', numberStyle: 'egyptian' } })}>🔊 صوت رجالي مصري قوي</button>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setS({ ...s, voice: { ...v, azureVoice: 'ar-BH-AliNeural', rate: -8, pitch: -2, volume: 1, repeatCount: 2, repeatDelaySec: 4, chime: true, style: 'standard', numberStyle: 'egyptian' } })}>↺ الافتراضي</button>
          <span className="text-[11px] text-slate-500">ثم «حفظ إعدادات الصوت»</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Slider label="سرعة الكلام" v={v.rate} min={-40} max={30} unit="%" on={(x: number) => setV('rate', x)} />
          <Slider label="طبقة الصوت" v={v.pitch} min={-20} max={20} unit="%" on={(x: number) => setV('pitch', x)} />
          <Slider label="مستوى الصوت على الشاشة" v={Math.round(v.volume * 100)} min={0} max={150} unit="%" on={(x: number) => setV('volume', x / 100)} />
          <Slider label="عدد مرات النداء" v={v.repeatCount} min={1} max={3} unit="" on={(x: number) => setV('repeatCount', x)} />
          <Slider label="الفاصل بين التكرار" v={v.repeatDelaySec} min={1} max={15} unit=" ث" on={(x: number) => setV('repeatDelaySec', x)} />
          <div className="space-y-2 pt-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.chime} onChange={(e) => setV('chime', e.target.checked)} /> نغمة تنبيه قبل النداء</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.includeName} onChange={(e) => setV('includeName', e.target.checked)} /> ذكر اسم المريض في النداء</label>
            {v.includeName && <p className="text-[11px] text-rose-600">تنبيه خصوصية: الاسم يُسمع في الصالة. يُذكر أول اسمين فقط ولا يُحفظ الصوت.</p>}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">صيغة النداء</label>
            <select className="input" value={v.style} onChange={(e) => setV('style', e.target.value)}>
              <option value="standard">عامية مصرية مهذبة (الدور على رقم…)</option><option value="formal">رسمية (برجاء التوجه إلى…)</option></select></div>
          <div><label className="label">نطق الأرقام</label>
            <select className="input" value={v.numberStyle} onChange={(e) => setV('numberStyle', e.target.value)}>
              <option value="egyptian">مصري: {spellNumber(13, 'egyptian')} – {spellNumber(28, 'egyptian')}</option>
              <option value="formal">فصيح: {spellNumber(13, 'formal')} – {spellNumber(28, 'formal')}</option></select></div>
        </div>
        <div>
          <div className="label">نصوص النداء ({set === 'formal' ? 'رسمية' : 'عامية'}) – {'{n}'} = الرقم، {'{room}'} = الغرفة</div>
          <div className="grid gap-2">
            {(['call', 'repeat', 'recall'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-slate-500">{{ call: 'نداء', repeat: 'تكرار', recall: 'نداء مريض سابق' }[k]}</span>
                <input className="input" value={s.templates[set][k]} onChange={(e) => setS({ ...s, templates: { ...s.templates, [set]: { ...s.templates[set], [k]: e.target.value } } })} />
              </div>))}
          </div>
        </div>
        <button className="btn-primary" onClick={() => save({ settings: s })}>حفظ إعدادات الصوت</button>
      </div>

      <div className="card space-y-3 p-5">
        <h3 className="font-bold">تجربة النداء</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">الرقم</label><input className="input w-24" type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, +e.target.value))} /></div>
          <div><label className="label">النوع</label><select className="input" value={variant} onChange={(e) => setVariant(e.target.value)}><option value="call">نداء</option><option value="repeat">تكرار</option><option value="recall">نداء مريض سابق</option></select></div>
          <button className="btn-gold" disabled={busy} onClick={() => preview()}>▶ استماع</button>
        </div>
        <p className="rounded-lg bg-slate-50 p-3 text-lg">{sample}</p>
        <p className="text-xs text-slate-500">التجربة تستخدم الإعدادات الحالية قبل الحفظ. جرّب أرقام صعبة: ١١، ١٢، ٣٠٠، ٨٨.</p>
      </div>

      <div className="card space-y-3 p-5">
        <h3 className="font-bold">تجهيز النداءات مسبقاً (Cache)</h3>
        <p className="text-sm text-slate-600">يولّد ويحفظ صوت النداء والتكرار للأرقام من ١ إلى N بالإعدادات المحفوظة — نداء فوري بلا انتظار وتكلفة مرة واحدة فقط. أعد التشغيل بعد تغيير الصوت أو النصوص.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label">حتى رقم</label><input className="input w-24" type="number" value={upto} onChange={(e) => setUpto(Math.min(300, Math.max(1, +e.target.value)))} /></div>
          <button className="btn-primary" disabled={!tts.azure && !tts.elevenlabs || (gen !== null && gen.done < gen.total)} onClick={pregenerate}>توليد</button>
          {gen && <span className="text-sm num">{toArabicDigits(gen.done)} / {toArabicDigits(gen.total)} {gen.errors ? `· أخطاء ${toArabicDigits(gen.errors)}` : ''}</span>}
        </div>
      </div>
    </div>
  );
}

function Slider({ label, v, min, max, unit, on }: any) {
  return (<div><label className="label">{label}: <span className="num">{v}{unit}</span></label>
    <input type="range" className="w-full accent-ink-800" min={min} max={max} value={v} onChange={(e) => on(+e.target.value)} /></div>);
}

function SheetTab({ sheet, setSheet, save, clinics }: any) {
  const [p, setP] = useState<any>(null); const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    const r = await fetch('/api/admin/sheet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheet }) });
    setP(await r.json()); setBusy(false);
  }
  useEffect(() => { test(); }, []); // eslint-disable-line
  const headers: string[] = p?.headers ?? [];
  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-4">
          <div><label className="label">اسم التبويب (فارغ = الأول)</label><input className="input" value={sheet.tab} onChange={(e) => setSheet({ ...sheet, tab: e.target.value })} /></div>
          <div><label className="label">صف العناوين</label><input className="input" type="number" min={1} value={sheet.headerRow} onChange={(e) => setSheet({ ...sheet, headerRow: +e.target.value })} /></div>
          <div><label className="label">صيغة التاريخ النصي</label><select className="input" value={sheet.dateOrder} onChange={(e) => setSheet({ ...sheet, dateOrder: e.target.value })}><option value="dmy">dd/MM/yyyy</option><option value="mdy">MM/dd/yyyy</option></select></div>
          <div><label className="label">العيادة الافتراضية (لو لا يوجد عمود عيادة)</label><select className="input" value={sheet.defaultClinic} onChange={(e) => setSheet({ ...sheet, defaultClinic: e.target.value })}>{clinics.map((c: any) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</select></div>
        </div>
        <div><label className="label">كلمات تدل على الإلغاء (في عمود الإجراء أو الحالة)</label>
          <input className="input" value={sheet.cancelKeywords.join('، ')} onChange={(e) => setSheet({ ...sheet, cancelKeywords: e.target.value.split(/[,،]/).map((x: string) => x.trim()).filter(Boolean) })} /></div>
        <div>
          <div className="label">ربط الأعمدة (تلقائي – غيّر فقط إذا كان التعرف خاطئاً)</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELDS.map((f: Field) => (
              <div key={f} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-sm font-semibold">{FIELD_LABEL_AR[f]}</span>
                <select className="input" value={sheet.mapping[f] ?? ''} onChange={(e) => setSheet({ ...sheet, mapping: { ...sheet.mapping, [f]: e.target.value || undefined } })}>
                  <option value="">تلقائي {p?.map?.[f] >= 0 ? `← ${headers[p.map[f]]}` : '(غير موجود)'}</option>
                  {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                </select>
              </div>))}
          </div>
        </div>
        <div className="flex gap-2"><button className="btn-ghost" disabled={busy} onClick={test}>{busy ? '…' : 'اختبار القراءة'}</button><button className="btn-primary" onClick={() => save({ sheet }, 'تم حفظ ربط الشيت')}>حفظ</button></div>
      </div>
      {p && (
        <div className="card p-5 text-sm">
          {!p.ok ? <p className="text-rose-700">تعذرت القراءة: {p.error}</p> : (<>
            <p className="mb-2">المصدر: <b>{p.source}</b> · صفوف: {p.stats.total} · اليوم: {p.stats.today} · ملغاة: {p.stats.cancelled} · عيادة غير معروفة: {p.stats.unknownClinic} · بلا تاريخ: {p.stats.noDate} · صفوف مكررة: {p.stats.duplicateRows}</p>
            {p.missing.length > 0 && <p className="mb-2 text-amber-700">أعمدة غير موجودة: {p.missing.map((f: Field) => FIELD_LABEL_AR[f]).join('، ')}</p>}
            {Object.entries(p.sample).map(([c, rows]: any) => (
              <div key={c} className="mb-3"><div className="font-bold">{clinics.find((x: any) => x.id === c)?.name_ar ?? c}</div>
                <table className="mt-1 w-full text-xs"><tbody>{rows.map((r: any) => (
                  <tr key={r.booking_key} className="border-b border-slate-100"><td className="py-1 num" dir="ltr">{r.booking_id ?? r.booking_key}</td><td>{r.appt_time}</td><td>{r.name}</td><td>{r.procedure}</td><td>{r.cancelled ? '❌ ملغي' : ''}{r.dup_hint ? '⚠ مكرر' : ''}</td></tr>))}</tbody></table></div>))}
          </>)}
        </div>)}
    </div>
  );
}

function StaffTab({ clinics }: any) {
  const [list, setList] = useState<any[]>([]); const [f, setF] = useState<any>({ username: '', display_name: '', password: '', role: 'reception', clinics: [] });
  const [msg, setMsg] = useState('');
  const load = () => fetch('/api/admin/staff').then((r) => r.json()).then((j) => setList(j.staff ?? []));
  useEffect(() => { load(); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const j = await (await fetch('/api/admin/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })).json();
    setMsg(j.ok ? 'تم الحفظ' : `خطأ: ${j.error}`); if (j.ok) { setF({ ...f, username: '', password: '', display_name: '' }); load(); }
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form className="card space-y-3 p-5" onSubmit={submit}>
        <h3 className="font-bold">إضافة / تعديل مستخدم</h3>
        <input className="input" dir="ltr" placeholder="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        <input className="input" placeholder="الاسم الظاهر" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        <input className="input" dir="ltr" type="password" placeholder="كلمة المرور (٦ أحرف على الأقل؛ فارغ = بدون تغيير)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="reception">استقبال</option><option value="admin">مسؤول</option></select>
        <div className="flex flex-wrap gap-3 text-sm">{clinics.map((c: any) => (
          <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={f.clinics.includes(c.id)} onChange={(e) => setF({ ...f, clinics: e.target.checked ? [...f.clinics, c.id] : f.clinics.filter((x: string) => x !== c.id) })} />{c.name_ar}</label>))}
          <span className="text-xs text-slate-400">(لا شيء = كل العيادات)</span></div>
        <button className="btn-primary">حفظ</button>{msg && <span className="ms-2 text-sm">{msg}</span>}
      </form>
      <div className="card divide-y divide-slate-100">
        {list.map((u) => (
          <div key={u.id} className="flex items-center gap-2 p-3 text-sm">
            <div className="flex-1"><b>{u.display_name}</b> <span className="text-slate-400" dir="ltr">@{u.username}</span><div className="text-xs text-slate-500">{u.role === 'admin' ? 'مسؤول' : 'استقبال'} · {u.clinics?.join('، ') || 'كل العيادات'}</div></div>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setF({ username: u.username, display_name: u.display_name, password: '', role: u.role, clinics: u.clinics ?? [] })}>تعديل</button>
            <button className="btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm('حذف المستخدم؟')) { await fetch(`/api/admin/staff?username=${u.username}`, { method: 'DELETE' }); load(); } }}>حذف</button>
          </div>))}
        {!list.length && <p className="p-4 text-sm text-slate-400">لا يوجد مستخدمون بعد – أنت داخل بحساب المسؤول من متغيرات البيئة.</p>}
      </div>
    </div>
  );
}

function LinksTab({ clinics, k }: any) {
  const origin = typeof window !== 'undefined' ? location.origin : '';
  const copy = (t: string) => navigator.clipboard?.writeText(t);
  return (
    <div className="card divide-y divide-slate-100">
      {!k && <p className="p-4 text-rose-700">DISPLAY_KEY غير مضبوط في متغيرات البيئة.</p>}
      {clinics.map((c: any) => {
        const disp = `${origin}/display/${c.id}?k=${encodeURIComponent(k)}&label=${encodeURIComponent('شاشة ' + c.name_ar)}`;
        const rec = `${origin}/reception/${c.id}`;
        return (
          <div key={c.id} className="space-y-2 p-4">
            <div className="font-bold">{c.name_ar}</div>
            {[['شاشة الانتظار (التلفزيون)', disp], ['لوحة الاستقبال', rec]].map(([l, u]) => (
              <div key={l} className="flex items-center gap-2 text-sm">
                <span className="w-44 shrink-0 text-slate-500">{l}</span>
                <code className="flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs" dir="ltr">{u}</code>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => copy(u)}>نسخ</button>
                <a className="btn-ghost px-2 py-1 text-xs" href={u} target="_blank" rel="noreferrer">فتح</a>
              </div>))}
          </div>);
      })}
      <p className="p-4 text-xs text-slate-500">رابط الشاشة يحتوي مفتاح العرض – لا يُنشر للعامة. يعرض الأرقام فقط بدون أي بيانات للمرضى. لتغيير المفتاح غيّر DISPLAY_KEY في Vercel ثم أعد النشر.</p>
    </div>
  );
}
