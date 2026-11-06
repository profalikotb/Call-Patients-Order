// Spell queue numbers for TTS. Two registers:
//  egyptian – colloquial Cairene (تلاتة، تمانية، حداشر، ميتين) – sounds natural with ar-EG-ShakirNeural
//  formal   – MSA spelling with spoken genitive endings (ثلاثة، أحد عشر، عشرين، مئتين)
export type NumberStyle = 'egyptian' | 'formal';

const T = {
  egyptian: {
    ones: ['صفر', 'واحد', 'اتنين', 'تلاتة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية', 'تسعة', 'عشرة'],
    teens: ['', 'حداشر', 'اتناشر', 'تلاتاشر', 'أربعتاشر', 'خمستاشر', 'ستاشر', 'سبعتاشر', 'تمنتاشر', 'تسعتاشر'],
    tens: ['', '', 'عشرين', 'تلاتين', 'أربعين', 'خمسين', 'ستين', 'سبعين', 'تمانين', 'تسعين'],
    hundreds: ['', 'مية', 'ميتين', 'تلتمية', 'ربعمية', 'خمسمية', 'ستمية', 'سبعمية', 'تمنمية', 'تسعمية'],
    thousand: 'ألف', twoThousand: 'ألفين',
    thousandsN: ['', '', '', 'تلات تلاف', 'أربع تلاف', 'خمس تلاف', 'ست تلاف', 'سبع تلاف', 'تمن تلاف', 'تسع تلاف'],
  },
  formal: {
    ones: ['صفر', 'واحد', 'اثنين', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'],
    teens: ['', 'أحد عشر', 'اثني عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'],
    tens: ['', '', 'عشرين', 'ثلاثين', 'أربعين', 'خمسين', 'ستين', 'سبعين', 'ثمانين', 'تسعين'],
    hundreds: ['', 'مئة', 'مئتين', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'],
    thousand: 'ألف', twoThousand: 'ألفين',
    thousandsN: ['', '', '', 'ثلاثة آلاف', 'أربعة آلاف', 'خمسة آلاف', 'ستة آلاف', 'سبعة آلاف', 'ثمانية آلاف', 'تسعة آلاف'],
  },
} as const;

function below100(n: number, s: NumberStyle): string {
  const t = T[s];
  if (n <= 10) return t.ones[n];
  if (n < 20) return t.teens[n - 10];
  const u = n % 10, d = Math.floor(n / 10);
  return u === 0 ? t.tens[d] : `${t.ones[u]} و${t.tens[d]}`;
}

function below1000(n: number, s: NumberStyle): string {
  const h = Math.floor(n / 100), r = n % 100;
  if (h === 0) return below100(r, s);
  const head = T[s].hundreds[h];
  return r === 0 ? head : `${head} و${below100(r, s)}`;
}

export function spellNumber(n: number, style: NumberStyle = 'egyptian'): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid queue number: ${n}`);
  if (n < 1000) return below1000(n, style);
  if (n >= 10000) return String(n); // beyond any realistic clinic day
  const th = Math.floor(n / 1000), r = n % 1000;
  const t = T[style];
  const head = th === 1 ? t.thousand : th === 2 ? t.twoThousand : t.thousandsN[th];
  return r === 0 ? head : `${head} و${below1000(r, style)}`;
}
