import { describe, it, expect } from 'vitest';
import { renderAnnouncement, decidePlay } from '@/lib/announce';
import { mergeSettings } from '@/lib/config';

const s = mergeSettings({}, 'heliopolis');

describe('renderAnnouncement', () => {
  it('standard Egyptian template matches spec examples', () => {
    expect(renderAnnouncement(s, 5, 'call')).toBe('الدور على رقم خمسة، اتفضل بالدخول.');
    expect(renderAnnouncement(s, 6, 'recall')).toBe('المريض صاحب رقم ستة، اتفضل بالدخول.');
  });
  it('formal template uses room label', () => {
    const f = mergeSettings({ voice: { style: 'formal' } }, 'x');
    expect(renderAnnouncement(f, 5, 'call')).toBe('رقم خمسة، برجاء التوجه إلى غرفة الكشف.');
    expect(renderAnnouncement(f, 5, 'repeat')).toBe('بنكرر النداء على رقم خمسة، برجاء التوجه إلى غرفة الكشف.');
  });
  it('never includes the name unless enabled; then only two name parts', () => {
    expect(renderAnnouncement(s, 3, 'call', 'محمد أحمد عبد الله')).not.toContain('محمد');
    const n = mergeSettings({ voice: { includeName: true } }, 'x');
    expect(renderAnnouncement(n, 3, 'call', 'محمد أحمد عبد الله')).toBe('محمد أحمد، الدور على رقم تلاتة، اتفضل بالدخول.');
  });
});

describe('decidePlay – reconnect / multi-device safety', () => {
  const now = 1_000_000;
  const a = { seq: 7, kind: 'call' as const, number: 12, at: now - 2000, silent: false };
  const ok = { lastHandledSeq: 6, serverNowMs: now, isHolder: true, unlocked: true };
  it('plays a fresh, unseen announcement on the lease holder', () => expect(decidePlay(a, ok)).toBe('play'));
  it('never replays a handled seq', () => expect(decidePlay(a, { ...ok, lastHandledSeq: 7 })).toBe('skip_seen'));
  it('non-holder devices stay silent (no double speakers)', () => expect(decidePlay(a, { ...ok, isHolder: false })).toBe('skip_not_holder'));
  it('stale announcement after reconnect is shown but NOT spoken', () =>
    expect(decidePlay({ ...a, at: now - 60_000 }, ok)).toBe('skip_old'));
  it('paused → silent', () => expect(decidePlay({ ...a, silent: true }, ok)).toBe('skip_silent'));
  it('audio not unlocked → no attempt', () => expect(decidePlay(a, { ...ok, unlocked: false })).toBe('skip_locked'));
  it('nothing to play', () => expect(decidePlay(null, ok)).toBe('skip_none'));
});
