// Egyptian Arabic male TTS.
//   Primary : Azure Neural "ar-EG-ShakirNeural" (male, Egypt locale – verified Egyptian voice)
//   Optional: ElevenLabs with an Egyptian male voice ID you choose from their library
//   Last    : the TV browser's own ar-EG voice (handled client-side)
// Every synthesis is cached in Supabase Storage by content hash → each phrase is paid for once.
import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { db } from './db';
import type { VoiceSettings } from '../config';

const BUCKET = 'tts-cache';
let bucketReady = false;
const mem = new Map<string, Buffer>(); // warm-lambda cache

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

export function buildSsml(text: string, v: VoiceSettings): string {
  const rate = `${v.rate >= 0 ? '+' : ''}${Math.round(v.rate)}%`;
  const pitch = `${v.pitch >= 0 ? '+' : ''}${Math.round(v.pitch)}%`;
  // a short lead-in break avoids clipped first syllable on some TV audio paths (HDMI wake-up)
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ar-EG">` +
    `<voice name="${esc(v.azureVoice)}"><mstts:silence type="Leading-exact" value="250ms"/>` +
    `<prosody rate="${rate}" pitch="${pitch}">${esc(text)}</prosody></voice></speak>`;
}

export function providersAvailable() {
  return {
    azure: !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
  };
}

async function azure(text: string, v: VoiceSettings): Promise<Buffer> {
  const region = process.env.AZURE_SPEECH_REGION, key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) throw new Error('azure_not_configured');
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'smart-patient-queue',
    },
    body: buildSsml(text, v),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`azure_${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function eleven(text: string, v: VoiceSettings): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = v.elevenVoiceId || process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw new Error('elevenlabs_not_configured');
  const speed = Math.min(1.2, Math.max(0.7, 1 + v.rate / 100));
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2', language_code: 'ar',
      voice_settings: { stability: 0.6, similarity_boost: 0.8, speed } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`elevenlabs_${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function order(v: VoiceSettings): Array<'azure' | 'elevenlabs'> {
  const avail = providersAvailable();
  const pref: Array<'azure' | 'elevenlabs'> = v.provider === 'elevenlabs' ? ['elevenlabs', 'azure'] : ['azure', 'elevenlabs'];
  return pref.filter((p) => avail[p]);
}

export function cacheKey(text: string, v: VoiceSettings, provider: string) {
  const voice = provider === 'azure' ? v.azureVoice : v.elevenVoiceId || process.env.ELEVENLABS_VOICE_ID;
  return createHash('sha256').update([provider, voice, v.rate, v.pitch, text].join('|')).digest('hex').slice(0, 40);
}

async function ensureBucket() {
  if (bucketReady) return;
  const s = db().storage;
  const { data } = await s.getBucket(BUCKET);
  if (!data) await s.createBucket(BUCKET, { public: false });
  bucketReady = true;
}

export interface SpeechResult { audio: Buffer; provider: string; cached: boolean }

/** persist=false for name-bearing phrases (not stored at rest). */
export async function speak(text: string, v: VoiceSettings, persist = true): Promise<SpeechResult> {
  const providers = order(v);
  if (!providers.length) throw new Error('no_tts_provider');
  let lastErr: unknown;
  for (const p of providers) {
    const key = cacheKey(text, v, p);
    const hit = mem.get(key);
    if (hit) return { audio: hit, provider: p, cached: true };
    if (persist) {
      try {
        await ensureBucket();
        const { data } = await db().storage.from(BUCKET).download(`${key}.mp3`);
        if (data) { const b = Buffer.from(await data.arrayBuffer()); remember(key, b); return { audio: b, provider: p, cached: true }; }
      } catch { /* cache miss or storage down – synthesize */ }
    }
    try {
      const audio = p === 'azure' ? await azure(text, v) : await eleven(text, v);
      if (persist) {
        remember(key, audio);
        const up = () => db().storage.from(BUCKET).upload(`${key}.mp3`, audio, { contentType: 'audio/mpeg', upsert: true }).then(() => {}, () => {});
        try { after(up); } catch { await up(); } // after() keeps the lambda alive post-response on Vercel
      }
      return { audio, provider: p, cached: false };
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error('tts_failed');
}

function remember(k: string, b: Buffer) {
  if (mem.size > 400) mem.delete(mem.keys().next().value!);
  mem.set(k, b);
}

export function audioResponse(r: SpeechResult, maxAge: number) {
  return new Response(new Uint8Array(r.audio), {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': maxAge > 0 ? `private, max-age=${maxAge}` : 'no-store',
      'X-TTS-Provider': r.provider,
      'X-TTS-Cached': String(r.cached),
    },
  });
}
