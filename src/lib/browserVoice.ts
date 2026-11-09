// Picks the browser (Edge) voice that matches the chosen Microsoft voice, e.g. ar-BH-AliNeural →
// «Microsoft Ali Online (Natural) - Arabic (Bahrain)». Edge in ARABIC shows names in Arabic («علي»), so both are matched.
import { ARABIC_MALE_VOICES } from './config';

export const FEMALE_AR = /(hoda|salma|zariyah|laila|layla|amina|amany|fatima|mouna|iman|sana|noura|rana|reem|sara|mariam|maryam|hala|google|هدى|هدي|سلمى|سلمي|زارية|ليلى|ليلي|أمينة|امينة|أماني|اماني|فاطمة|فاطمه|منى|مني|إيمان|ايمان|سناء|نورا|نورة|رنا|ريم|سارة|ساره|مريم|هالة|هاله)/i;
const MALE_AR = /(shakir|hamed|naayf|bassel|moaz|rami|taim|hamdan|omar|jamal|fahed|abdullah|ali\b|majed|maged|tarik|male|شاكر|حامد|نايف|باسل|معاذ|رامي|تيم|حمدان|عمر|جمال|فهد|عبدالله|عبد الله|ماجد|طارق|علي|على)/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** regex that recognises the chosen voice in English or Arabic */
export function wantedVoiceRe(id?: string | null): RegExp {
  const v = ARABIC_MALE_VOICES.find((x) => x.id === id) ?? ARABIC_MALE_VOICES[0];
  const ar = v.ar === 'علي' ? 'علي|على' : esc(v.ar);
  return new RegExp(`(\\b${esc(v.en)}\\b|${ar})`, 'i');
}

export function pickVoice(voices: SpeechSynthesisVoice[], id?: string | null): SpeechSynthesisVoice | undefined {
  const want = ARABIC_MALE_VOICES.find((x) => x.id === id) ?? ARABIC_MALE_VOICES[0];
  const re = wantedVoiceRe(want.id);
  const region = want.id.slice(0, 5);                                       // e.g. ar-BH
  const ar = voices.filter((x) => /^ar/i.test(x.lang));
  return ar.find((x) => (re.test(x.name) || re.test(x.voiceURI)) && !FEMALE_AR.test(x.name))
    ?? ar.find((x) => x.lang.replace('_', '-').toLowerCase() === region.toLowerCase() && MALE_AR.test(x.name) && !FEMALE_AR.test(x.name))
    ?? ar.find((x) => /shakir|شاكر/i.test(x.name))                          // Egyptian male
    ?? ar.find((x) => MALE_AR.test(x.name) && !FEMALE_AR.test(x.name))
    ?? ar.find((x) => !FEMALE_AR.test(x.name))
    ?? ar[0];
}
