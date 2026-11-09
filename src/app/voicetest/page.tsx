'use client';
// Voice test: open https://call-patients-order.vercel.app/voicetest in the TV's Edge, press the button.
import { useEffect, useState } from 'react';

export default function VoiceTest() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const add = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString('en-GB')}  ${m}`, ...l].slice(0, 30));
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load(); window.speechSynthesis?.addEventListener('voiceschanged', load);
    const t = setInterval(load, 1000);
    return () => { clearInterval(t); window.speechSynthesis?.removeEventListener('voiceschanged', load); };
  }, []);
  const ar = voices.filter((v) => /^ar/i.test(v.lang));
  const speak = (v?: SpeechSynthesisVoice) => {
    const ss = window.speechSynthesis;
    if (!ss) return add('❌ This browser has no speech engine');
    const u = new SpeechSynthesisUtterance('رقم خمسة، اتفضل لغرفة الكشف');
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ar-EG';
    u.onstart = () => add(`▶ speaking: ${v?.name ?? 'default'}`);
    u.onend = () => add('✔ finished');
    u.onerror = (e) => add(`❌ error: ${(e as any).error}`);
    ss.speak(u); add(`… requested: ${v?.name ?? 'default'}`);
  };
  const beep = () => {
    const c = new AudioContext(); const o = c.createOscillator(); o.connect(c.destination); o.start(); o.stop(c.currentTime + 0.4);
    add('🔔 beep played (if you heard it, the speakers work)');
  };
  const shakir = ar.find((v) => /shakir|شاكر/i.test(v.name));
  return (
    <main dir="rtl" className="mx-auto max-w-2xl space-y-4 p-6 font-sans">
      <h1 className="text-2xl font-black">اختبار صوت النداء</h1>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-xl bg-amber-500 px-5 py-3 font-bold" onClick={beep}>🔔 1) جرس</button>
        <button className="rounded-xl bg-blue-700 px-5 py-3 font-bold text-white" onClick={() => speak(shakir)} disabled={!shakir}>🗣 2) شاكر {shakir ? '' : '(غير موجود)'}</button>
        <button className="rounded-xl bg-slate-700 px-5 py-3 font-bold text-white" onClick={() => speak()}>🗣 3) الصوت الافتراضي</button>
      </div>
      <p className="text-sm">المتصفح: <b dir="ltr">{typeof navigator !== 'undefined' ? navigator.userAgent.match(/Edg\/[\d.]+|Chrome\/[\d.]+|Firefox\/[\d.]+/)?.[0] : ''}</b> · كل الأصوات: <b>{voices.length}</b> · العربية: <b>{ar.length}</b></p>
      <ul className="space-y-1 text-sm">
        {ar.map((v) => (
          <li key={v.voiceURI} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5">
            <span dir="ltr">{v.name} <span className="text-slate-500">({v.lang})</span></span>
            <button className="rounded bg-slate-800 px-2 py-0.5 text-xs text-white" onClick={() => speak(v)}>تجربة</button>
          </li>))}
      </ul>
      <pre dir="ltr" className="rounded-lg bg-black p-3 text-xs text-green-400">{log.join('\n') || 'press a button…'}</pre>
    </main>
  );
}
