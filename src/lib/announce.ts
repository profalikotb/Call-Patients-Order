// Announcement text + client playback decision (isomorphic, unit-tested)
import { spellNumber } from './numbers';
import type { ClinicSettings, Variant } from './config';

export function renderAnnouncement(
  s: Pick<ClinicSettings, 'voice' | 'templates' | 'room_label'>,
  number: number,
  variant: Variant,
  name?: string | null,
): string {
  const set = s.voice.style === 'formal' ? s.templates.formal : s.templates.standard;
  const tpl = set[variant] || set.call;
  const n = spellNumber(number, s.voice.numberStyle);
  let text = tpl.replaceAll('{n}', n).replaceAll('{room}', s.room_label || 'غرفة الكشف').replaceAll('{name}', '');
  if (s.voice.includeName && name && name.trim()) {
    // first two name parts only – enough to be identifiable, less exposure
    const short = name.trim().split(/\s+/).slice(0, 2).join(' ');
    text = s.templates.namePrefix.replaceAll('{name}', short) + text;
  }
  return text.replace(/\s+/g, ' ').trim();
}

export interface AnnounceState { seq: number; kind: Variant; number: number; at: number; silent: boolean }

export type PlayDecision = 'play' | 'skip_seen' | 'skip_old' | 'skip_silent' | 'skip_not_holder' | 'skip_locked' | 'skip_none';

/**
 * Decide whether THIS device should speak an announcement.
 * Rules: only the lease holder speaks; never replay a seq already handled; never speak an
 * announcement older than maxAgeMs (protects against reconnect / reload replaying an old call).
 */
export function decidePlay(
  ann: AnnounceState | null | undefined,
  ctx: { lastHandledSeq: number; serverNowMs: number; isHolder: boolean; unlocked: boolean; maxAgeMs?: number },
): PlayDecision {
  if (!ann || !ann.seq) return 'skip_none';
  if (ann.seq <= ctx.lastHandledSeq) return 'skip_seen';
  if (!ctx.unlocked) return 'skip_locked';
  if (!ctx.isHolder) return 'skip_not_holder';
  if (ann.silent) return 'skip_silent';
  if (ctx.serverNowMs - ann.at > (ctx.maxAgeMs ?? 20000)) return 'skip_old';
  return 'play';
}
