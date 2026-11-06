import { describe, it, expect } from 'vitest';
import { spellNumber } from '@/lib/numbers';

describe('spellNumber – Egyptian colloquial', () => {
  const cases: [number, string][] = [
    [1, 'واحد'], [2, 'اتنين'], [3, 'تلاتة'], [5, 'خمسة'], [8, 'تمانية'], [10, 'عشرة'], [11, 'حداشر'], [12, 'اتناشر'],
    [13, 'تلاتاشر'], [18, 'تمنتاشر'], [19, 'تسعتاشر'], [20, 'عشرين'], [21, 'واحد وعشرين'], [35, 'خمسة وتلاتين'],
    [99, 'تسعة وتسعين'], [100, 'مية'], [101, 'مية وواحد'], [115, 'مية وخمستاشر'], [200, 'ميتين'], [250, 'ميتين وخمسين'],
    [300, 'تلتمية'], [999, 'تسعمية وتسعة وتسعين'], [1000, 'ألف'], [2000, 'ألفين'], [3005, 'تلات تلاف وخمسة'],
  ];
  it.each(cases)('%i → %s', (n, s) => expect(spellNumber(n, 'egyptian')).toBe(s));
});

describe('spellNumber – formal', () => {
  const cases: [number, string][] = [
    [2, 'اثنين'], [3, 'ثلاثة'], [11, 'أحد عشر'], [12, 'اثني عشر'], [30, 'ثلاثين'], [42, 'اثنين وأربعين'],
    [100, 'مئة'], [200, 'مئتين'], [305, 'ثلاثمئة وخمسة'], [1100, 'ألف ومئة'],
  ];
  it.each(cases)('%i → %s', (n, s) => expect(spellNumber(n, 'formal')).toBe(s));
});

describe('spellNumber – every number 1..1000 is spelled with Arabic letters only', () => {
  it('egyptian & formal', () => {
    for (let n = 1; n <= 1000; n++) for (const st of ['egyptian', 'formal'] as const) {
      const s = spellNumber(n, st);
      expect(s).toMatch(/^[ء-ي ]+$/);
      expect(s).not.toMatch(/\s{2}|^\s|\s$/);
    }
  });
  it('rejects invalid', () => { expect(() => spellNumber(-1)).toThrow(); expect(() => spellNumber(1.5)).toThrow(); });
});
