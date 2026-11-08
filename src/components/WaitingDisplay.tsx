'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { watchDisplay } from '@/lib/supabaseBrowser';
import { decidePlay, type AnnounceState } from '@/lib/announce';
import { spellNumber } from '@/lib/numbers';
import { toArabicDigits } from '@/lib/arabic';
import type { Variant } from '@/lib/config';

const MAX_AGE_MS = 20000;   // never speak an announcement older than this (reload / reconnect safety)
const HEARTBEAT_MS = 20000; // lease renew (lease = 60 s server-side)

function deviceId() {
  try {
    let id = localStorage.getItem('pq_device');
    if (!id) { id = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem('pq_device', id!); }
    return id!;
  } catch { return `tmp-${Math.random().toString(36).slice(2, 12)}`; }
}


// Browser voices: the ONLY male Egyptian voice is Microsoft Edge's online "Shakir".
// Windows' own ar-EG voice (Hoda) and Google's Arabic voice are FEMALE → never pick them while a male exists.
// Edge in ARABIC shows the voice names in Arabic («Microsoft شاكر Online (Natural) - العربية (مصر)»),
// so every name is matched in both scripts.
const FEMALE_AR = /(hoda|salma|zariyah|laila|layla|amina|amany|fatima|mouna|iman|sana|noura|rana|reem|sara|mariam|maryam|hala|google|هدى|هدي|سلمى|سلمي|زارية|ليلى|ليلي|أمينة|امينة|أماني|اماني|فاطمة|فاطمه|منى|مني|إيمان|ايمان|سناء|نورا|نورة|رنا|ريم|سارة|ساره|مريم|هالة|هاله)/i;
const MALE_AR = /(shakir|hamed|naayf|bassel|moaz|rami|taim|hamdan|omar|jamal|fahed|abdullah|ali\b|majed|maged|tarik|male|شاكر|حامد|نايف|باسل|معاذ|رامي|تيم|حمدان|عمر|جمال|فهد|عبدالله|عبد الله|ماجد|طارق)/i;
const SHAKIR = /(shakir|شاكر)/i;
function pickMaleArabicVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const ar = voices.filter((x) => /^ar/i.test(x.lang));
  const eg = ar.filter((x) => /^ar[-_]EG/i.test(x.lang));
  return ar.find((x) => SHAKIR.test(x.name) || SHAKIR.test(x.voiceURI))            // Edge: Microsoft Shakir Online (Natural) – ar-EG male
    ?? eg.find((x) => MALE_AR.test(x.name))
    ?? eg.find((x) => /online|natural/i.test(x.name) && !FEMALE_AR.test(x.name))  // ar-EG online voice that is not Salma = Shakir
    ?? ar.find((x) => MALE_AR.test(x.name) && !FEMALE_AR.test(x.name))             // other Arabic male (e.g. Hamed, Naayf)
    ?? ar.find((x) => !FEMALE_AR.test(x.name))
    ?? ar[0];                                                                        // only female available (warned on screen)
}

export default function WaitingDisplay({ clinic, k, label, auto = false }: { clinic: string; k: string; label: string; auto?: boolean }) {
  const [st, setSt] = useState<any>(null);
  const [online, setOnline] = useState(true);
  const [live, setLive] = useState(false);
  const [stale, setStale] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [holder, setHolder] = useState<{ ok: boolean; label?: string; error?: string } | null>(null);
  const [stateErr, setStateErr] = useState('');
  const [flash, setFlash] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [audioNote, setAudioNote] = useState('');

  const dev = useRef<string>('');
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const offset = useRef(0);               // serverNow - Date.now()
  const lastSeq = useRef<number>(-1);     // -1 = not initialised yet (first load never plays)
  const stRef = useRef<any>(null);
  const jobId = useRef(0);
  const prefetched = useRef(new Map<string, AudioBuffer>());
  const unlockedRef = useRef(false);
  const holderRef = useRef(false);

  const cacheKey = `pq_display_${clinic}`;
  const q = (p: Record<string, string | number>) => new URLSearchParams({ clinic, k, ...Object.fromEntries(Object.entries(p).map(([a, b]) => [a, String(b)])) }).toString();

  // ------------------------------------------------------------- audio -----
  const chime = useCallback(async () => {
    const c = ctx.current; if (!c || !gain.current) return;
    const t0 = c.currentTime + 0.05;
    [[659.25, 0], [523.25, 0.45]].forEach(([f, d]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 1.1);
      o.connect(g).connect(gain.current!); o.start(t0 + d); o.stop(t0 + d + 1.2);
    });
    await new Promise((r) => setTimeout(r, 1500));
  }, []);

  const fetchBuffer = useCallback(async (url: string): Promise<AudioBuffer> => {
    const hit = prefetched.current.get(url); if (hit) return hit;
    const r = await fetch(url, { cache: 'force-cache' });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    const buf = await ctx.current!.decodeAudioData(await r.arrayBuffer());
    prefetched.current.set(url, buf);
    if (prefetched.current.size > 16) prefetched.current.delete(prefetched.current.keys().next().value!);
    return buf;
  }, []);

  const playBuffer = (buf: AudioBuffer) => new Promise<void>((res) => {
    const src = ctx.current!.createBufferSource(); src.buffer = buf; src.connect(gain.current!);
    src.onended = () => res(); src.start();
  });

  const browserSpeak = async (text: string) => {
    const ss = window.speechSynthesis; if (!ss) return;
    // voice list loads asynchronously (Chrome/Edge): wait for it, else the browser's default (often female) is used
    // Edge adds its ONLINE voices (Shakir) a moment after the local ones → wait until Shakir appears (max 3 s)
    const hasShakir = () => !!pickMaleArabicVoice(ss.getVoices()) && SHAKIR.test(pickMaleArabicVoice(ss.getVoices())!.name);
    for (let i = 0; i < 15 && !hasShakir(); i++) await new Promise((r) => setTimeout(r, 200));
    return speakWith(ss, text);
  };
  const speakWith = (ss: SpeechSynthesis, text: string) => new Promise<void>((res) => {
    const v = pickMaleArabicVoice(ss.getVoices());
    if (v && !SHAKIR.test(v.name)) console.warn('[queue] Egyptian male voice (Shakir) not found, using', v.name);
    const u = new SpeechSynthesisUtterance(text);
    const pb = stRef.current?.playback ?? {};
    if (v) u.voice = v; u.lang = v?.lang || 'ar-EG';
    // same speed / depth as the server voice settings (−40…+30 % → 0.6…1.3, −20…+20 % → 0.6…1.4)
    u.rate = Math.min(1.3, Math.max(0.6, 1 + (pb.rate ?? -8) / 100));
    u.pitch = Math.min(1.4, Math.max(0.6, 1 + (pb.pitch ?? -2) / 50));
    u.volume = Math.min(1, pb.volume ?? 1);
    u.onend = () => res(); u.onerror = () => res();
    ss.speak(u); setTimeout(res, 12000);
  });

  const urlFor = (a: AnnounceState, variant: Variant) => {
    const pb = stRef.current.playback;
    return pb.includeName ? `/api/tts/announcement?${q({ seq: a.seq, variant })}` : `/api/tts/number?${q({ n: a.number, variant, h: stRef.current.h })}`;
  };

  const announce = useCallback(async (a: AnnounceState) => {
    const my = ++jobId.current;                                   // newer call supersedes older one
    const pb = stRef.current.playback;
    if (gain.current) gain.current.gain.value = pb.volume ?? 1;
    const times = a.kind === 'repeat' ? 1 : Math.max(1, Math.min(3, pb.repeatCount ?? 1));
    setSpeaking(true);
    try {
      if (pb.chime) await chime();
      for (let i = 0; i < times; i++) {
        if (my !== jobId.current) return;
        const variant: Variant = i === 0 ? a.kind : 'repeat';
        let ok = false;
        if (pb.server_tts) {
          try { await playBuffer(await fetchBuffer(urlFor(a, variant))); ok = true; setAudioNote(''); } catch { /* fall through */ }
        }
        if (!ok) {
          const tpl = (pb.templates?.[variant] ?? pb.templates?.call ?? 'رقم {n}') as string;
          await browserSpeak(tpl.replaceAll('{n}', spellNumber(a.number, pb.numberStyle)).replaceAll('{room}', pb.room_label).replaceAll('{name}', ''));
        }
        if (i < times - 1) await new Promise((r) => setTimeout(r, (pb.repeatDelaySec ?? 4) * 1000));
      }
      fetch('/api/display/played', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic, k, seq: a.seq, deviceId: dev.current }) }).catch(() => {});
    } finally { if (my === jobId.current) setSpeaking(false); }
  }, [chime, fetchBuffer, clinic, k]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ state ------
  /** Always confirm against the server before acting on any change (realtime is only a nudge). */
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/display/state?${q({})}`, { cache: 'no-store' });
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as any));
        setStateErr(e.error === 'bad_display_key'
          ? 'مفتاح الشاشة (k) في الرابط غير صحيح – انسخ رابط الشاشة من الإدارة ← الروابط'
          : `تعذّر تحميل حالة الشاشة (${r.status}): ${e.detail || e.error || ''}`);
        throw new Error(String(r.status));
      }
      setStateErr('');
      const j = await r.json();
      offset.current = j.server_now - Date.now();
      stRef.current = j; setSt(j); setStale(false);
      try { localStorage.setItem(cacheKey, JSON.stringify({ ...j, cachedAt: Date.now() })); } catch {}
      const a: AnnounceState | null = j.state.announce;
      holderRef.current = j.state.audio_device_id === dev.current && new Date(j.state.audio_lease_until).getTime() > j.server_now;
      if (unlockedRef.current) setHolder({ ok: holderRef.current, label: j.state.audio_device_label ?? undefined });
      if (lastSeq.current === -1) { lastSeq.current = a?.seq ?? 0; return; }   // first load: show, never speak
      const decision = decidePlay(a, { lastHandledSeq: lastSeq.current, serverNowMs: j.server_now, isHolder: holderRef.current, unlocked: unlockedRef.current, maxAgeMs: MAX_AGE_MS });
      if (a && a.seq > lastSeq.current) {
        lastSeq.current = a.seq;
        if (a.kind !== 'repeat' || decision === 'play') setFlash((f) => f + 1);
        if (decision === 'play') announce(a);
      }
      // warm the cache for the next two numbers (number-only mode)
      if (unlockedRef.current && holderRef.current && j.playback.server_tts && !j.playback.includeName) {
        for (const n of (j.state.next_numbers ?? []).slice(0, 2)) {
          const u = `/api/tts/number?${q({ n, variant: 'call', h: j.h })}`;
          if (!prefetched.current.has(u)) fetchBuffer(u).catch(() => {});
        }
      }
    } catch { setStale(true); }
  }, [announce, fetchBuffer, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const claim = useCallback(async (force = false) => {
    try {
      const r = await fetch('/api/display/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic, k, deviceId: dev.current, label, force }) });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) {                                  // server refused (bad link key, server error) ≠ other device
        const why = j.error === 'bad_display_key'
          ? 'مفتاح الشاشة (k) في الرابط غير صحيح – انسخ الرابط من الإدارة ← الروابط'
          : `خطأ في الخادم (${r.status}): ${j.detail || j.error || ''}`;
        setHolder({ ok: false, error: why }); holderRef.current = false;
        return false;
      }
      setHolder({ ok: !!j.ok, label: j.holder }); holderRef.current = !!j.ok;
      return !!j.ok;
    } catch { return false; }
  }, [clinic, k, label]);

  useEffect(() => {
    dev.current = deviceId();
    try { const c = localStorage.getItem(cacheKey); if (c) { const j = JSON.parse(c); stRef.current = j; setSt(j); setStale(true); } } catch {}
    refresh();
    const off = watchDisplay(clinic, () => refresh(), (ok) => { setLive(ok); if (ok) refresh(); });
    const poll = setInterval(refresh, 15000);
    const tick = setInterval(() => setClock(new Date(Date.now() + offset.current)), 1000);
    const on = () => { setOnline(true); refresh(); }, offl = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', offl);
    setOnline(navigator.onLine);
    return () => { off(); clearInterval(poll); clearInterval(tick); window.removeEventListener('online', on); window.removeEventListener('offline', offl); };
  }, [clinic, refresh, cacheKey]);

  // lease heartbeat while this screen is the speaker
  useEffect(() => {
    if (!unlocked) return;
    const id = setInterval(() => { claim(false); }, HEARTBEAT_MS); // succeeds only if ours or expired
    const bye = () => navigator.sendBeacon?.('/api/display/claim', new Blob([JSON.stringify({ clinic, k, deviceId: dev.current, release: true })], { type: 'application/json' }));
    window.addEventListener('pagehide', bye);
    return () => { clearInterval(id); window.removeEventListener('pagehide', bye); };
  }, [unlocked, claim, clinic, k]);

  // keep the TV awake
  useEffect(() => {
    if (!unlocked) return;
    let lock: any = null;
    const get = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch {} };
    get();
    const vis = () => { if (!document.hidden) get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, [unlocked]);

  async function activate(force = false) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!ctx.current) { ctx.current = new AC(); gain.current = ctx.current.createGain(); gain.current.connect(ctx.current.destination); }
    await ctx.current.resume();
    const b = ctx.current.createBuffer(1, 1, 22050), s = ctx.current.createBufferSource(); s.buffer = b; s.connect(ctx.current.destination); s.start();
    try { window.speechSynthesis?.getVoices(); } catch {}
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    unlockedRef.current = true; setUnlocked(true);
    await claim(force);
    refresh();
  }
  // ?auto=1 → dedicated sound TV: activate WITHOUT a click when the browser allows autoplay
  // (Edge/Chrome started with --autoplay-policy=no-user-gesture-required, or site Sound = Allow).
  // Takes the sound over from any other screen. Falls back to the normal button otherwise.
  useEffect(() => {
    if (!auto || unlockedRef.current) return;
    let cancelled = false;
    const tryAuto = async () => {
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!ctx.current) { ctx.current = new AC(); gain.current = ctx.current.createGain(); gain.current.connect(ctx.current.destination); }
        await Promise.race([ctx.current.resume(), new Promise((r) => setTimeout(r, 800))]);
        if (cancelled || ctx.current.state !== 'running') { setAudioNote('التفعيل التلقائي غير مسموح في هذا المتصفح – اضغط «تفعيل الصوت»'); return; }
        const b = ctx.current.createBuffer(1, 1, 22050), src = ctx.current.createBufferSource(); src.buffer = b; src.connect(ctx.current.destination); src.start();
        try { window.speechSynthesis?.getVoices(); } catch {}
        unlockedRef.current = true; setUnlocked(true); setAudioNote('');
        await claim(true);
        refresh();
      } catch { /* keep the manual button */ }
    };
    const t = setTimeout(tryAuto, 600);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  async function silentMode() { unlockedRef.current = false; setUnlocked(true); try { await document.documentElement.requestFullscreen?.(); } catch {} }

  // ------------------------------------------------------------- render ----
  const D = (v: any) => (v === null || v === undefined ? '' : st?.display?.digits === 'western' ? String(v) : toArabicDigits(v));
  const s = st?.state;
  const dateStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(clock);
  const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true }).format(clock);
  const dayName = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long' }).format(clock);
  const audioOn = unlockedRef.current && holder?.ok;

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-ink-950 text-white select-none" style={{ cursor: unlocked ? 'none' : 'auto' }}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(212,167,44,.14),transparent_60%)]" />
      <div className="relative grid h-full grid-rows-[auto_1fr_auto]">
        {/* header */}
        <header className="flex items-center justify-between border-b border-white/10 px-[3vw] py-[1.6vh]">
          <div>
            <h1 className="font-display text-[3.1vw] font-extrabold leading-tight text-white">{st?.display?.title ?? 'عيادة الأستاذ الدكتور على قطب على'}</h1>
            <p className="text-[1.6vw] text-gold-300">{st?.display?.subtitle}</p>
          </div>
          <div className="text-end">
            <div className="num text-[3vw] font-bold leading-none">{D(timeStr.replace(' AM', '').replace(' PM', ''))} <span className="text-[1.6vw] text-white/60">{timeStr.endsWith('PM') ? 'م' : 'ص'}</span></div>
            <div className="num text-[1.4vw] text-white/60">{dayName} {D(dateStr)}</div>
          </div>
        </header>

        {/* main */}
        <main className="grid grid-cols-[1.7fr_1fr] gap-[2.5vw] px-[3vw] py-[3vh]">
          <section className={`relative flex flex-col items-center justify-center rounded-[2.5vw] bg-gradient-to-b from-ink-800 to-ink-900 ring-1 ring-gold-500/30 ${flash ? 'animate-glow' : ''}`} key={`g${flash}`}>
            <div className="text-[2.6vw] font-bold text-gold-300">الدور الحالي</div>
            <div key={`n${s?.current_number}-${flash}`} className="num animate-pop text-[22vw] font-black leading-[1] text-gold-400 drop-shadow-[0_0_40px_rgba(233,196,90,.35)]">
              {s?.current_number ? D(s.current_number) : '—'}
            </div>
            <div className="text-[2.4vw] font-semibold text-white/90">
              {s?.current_number ? `برجاء التوجه إلى ${s.room_label ?? 'غرفة الكشف'}` : 'مرحباً بكم'}
            </div>
            {speaking && <div className="absolute bottom-[2vh] start-[2vw] text-[1.4vw] text-gold-300">🔊 جارٍ النداء…</div>}
          </section>
          <section className="flex flex-col rounded-[2.5vw] bg-white/[.04] p-[2vw] ring-1 ring-white/10">
            <div className="mb-[2vh] text-center text-[2.2vw] font-bold text-white/80">الأرقام التالية</div>
            <div className="flex flex-1 flex-col justify-around">
              {(s?.next_numbers ?? []).length === 0 && <div className="text-center text-[2vw] text-white/40">—</div>}
              {(s?.next_numbers ?? []).map((n: number, i: number) => (
                <div key={n} className={`num text-center font-extrabold leading-none transition-all duration-700 ${i === 0 ? 'text-[9vw] text-white' : 'text-[6.5vw] text-white/55'}`}>{D(n)}</div>
              ))}
            </div>
            {s?.waiting_count > 0 && <div className="mt-[1vh] text-center text-[1.4vw] text-white/50">المنتظرون: <span className="num">{D(s.waiting_count)}</span></div>}
          </section>
        </main>

        {/* footer */}
        <footer className="flex items-center gap-4 overflow-hidden border-t border-white/10 bg-ink-900/60 px-[3vw] py-[1.4vh] text-[1.5vw]">
          <div className="flex-1 truncate text-white/70">{st?.display?.ticker}</div>
          <div className="flex items-center gap-3 text-[1.1vw] text-white/50">
            {s?.paused && <span className="text-amber-300">النداء الصوتي متوقف</span>}
            <span>{audioOn ? '🔊' : '🔇'}</span>
            <span className={`h-[1vw] w-[1vw] rounded-full ${online && live && !stale ? 'bg-emerald-400' : online && !stale ? 'bg-amber-400' : 'bg-rose-500'}`} />
          </div>
        </footer>
      </div>

      {(!online || stale) && st && (
        <div className="absolute inset-x-0 top-0 bg-rose-600/90 py-[.6vh] text-center text-[1.3vw] font-semibold">
          غير متصل – يتم عرض آخر حالة مؤكدة {st.cachedAt ? `(${new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(new Date(st.cachedAt))})` : ''}
        </div>)}

      {stateErr && (
        <div className="absolute inset-x-0 top-[5vh] mx-auto w-fit max-w-[90vw] rounded-2xl bg-rose-600 px-6 py-3 text-[1.3vw] font-semibold text-white" dir="auto">
          ⚠ {stateErr}
        </div>)}

      {unlocked && holder && !holder.ok && holder.error && (
        <div className="absolute inset-x-0 bottom-[9vh] mx-auto w-fit max-w-[90vw] rounded-2xl bg-rose-600 px-6 py-3 text-white" dir="auto">
          ⚠ تعذّر تفعيل الصوت: {holder.error}
          <button className="ms-3 rounded-lg bg-white px-3 py-1 text-ink-950" onClick={() => activate(true)}>إعادة المحاولة</button>
        </div>)}

      {unlocked && holder && !holder.ok && !holder.error && unlockedRef.current && (
        <div className="absolute inset-x-0 bottom-[9vh] mx-auto w-fit rounded-2xl bg-amber-500 px-6 py-3 text-ink-950" style={{ cursor: 'auto' }}>
          الصوت مفعّل على جهاز آخر{holder.label ? ` (${holder.label})` : ''} —
          <button className="ms-3 rounded-lg bg-ink-950 px-3 py-1 text-white" onClick={() => activate(true)}>نقل الصوت لهذه الشاشة</button>
        </div>)}

      {!unlocked && (
        <div className="absolute inset-0 grid place-items-center bg-ink-950/85 backdrop-blur-sm">
          <div className="text-center">
            <button onClick={() => activate(false)} className="rounded-[2vw] bg-gold-500 px-[5vw] py-[3vh] font-display text-[3.5vw] font-black text-ink-950 shadow-2xl ring-8 ring-gold-500/20 hover:bg-gold-400">
              🔊 تفعيل الصوت
            </button>
            <p className="mt-[3vh] text-[1.4vw] text-white/60">يُضغط مرة واحدة عند تشغيل الشاشة – المتصفح يمنع تشغيل الصوت تلقائياً</p>
            <button onClick={silentMode} className="mt-[2vh] text-[1.2vw] text-white/40 underline">عرض فقط بدون صوت (شاشة إضافية)</button>
          </div>
        </div>)}
    </div>
  );
}
