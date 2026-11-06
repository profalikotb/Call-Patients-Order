// Shared types + defaults (isomorphic)
import type { NumberStyle } from './numbers';

export type Status = 'booked' | 'waiting' | 'called' | 'in_room' | 'done' | 'absent' | 'postponed' | 'cancelled';
export type Policy = 'time' | 'checkin' | 'manual';
export type Variant = 'call' | 'repeat' | 'recall';

export const STATUS_AR: Record<Status, string> = {
  booked: 'لم يصل', waiting: 'منتظر', called: 'تم النداء', in_room: 'داخل الكشف',
  done: 'تم الكشف', absent: 'غائب', postponed: 'مؤجل', cancelled: 'ملغي',
};
export const STATUS_EN: Record<Status, string> = {
  booked: 'Not arrived', waiting: 'Waiting', called: 'Called', in_room: 'In room',
  done: 'Seen', absent: 'Absent', postponed: 'Postponed', cancelled: 'Cancelled',
};

export interface VoiceSettings {
  provider: 'azure' | 'elevenlabs' | 'browser';
  azureVoice: string;           // ar-EG-ShakirNeural = male Egyptian neural
  elevenVoiceId: string;        // optional: an Egyptian male voice from your ElevenLabs library
  rate: number;                 // percent, -40..+30
  pitch: number;                // percent, -20..+20
  volume: number;               // 0..1.5 (gain on the TV, >1 = boost)
  repeatCount: number;          // 1..3 – how many times one call is spoken
  repeatDelaySec: number;       // gap between repetitions
  chime: boolean;
  style: 'standard' | 'formal';  // which template set
  numberStyle: NumberStyle;      // egyptian (تلاتة) or formal (ثلاثة)
  includeName: boolean;          // privacy: OFF by default
}

export interface Templates {
  standard: Record<Variant, string>;
  formal: Record<Variant, string>;
  namePrefix: string;
}

export interface DisplaySettings {
  title: string;
  subtitle: string;
  ticker: string;
  digits: 'arabic' | 'western';
}

export interface ClinicSettings {
  clinic_id: string;
  policy: Policy;
  room_label: string;
  default_consult_minutes: number;
  voice: VoiceSettings;
  templates: Templates;
  display: DisplaySettings;
}

export const DEFAULT_VOICE: VoiceSettings = {
  provider: 'azure',
  azureVoice: 'ar-EG-ShakirNeural',
  elevenVoiceId: '',
  rate: -8,
  pitch: -2,
  volume: 1,
  repeatCount: 2,
  repeatDelaySec: 4,
  chime: true,
  style: 'standard',
  numberStyle: 'egyptian',
  includeName: false,
};

export const DEFAULT_TEMPLATES: Templates = {
  standard: {
    call: 'الدور على رقم {n}، اتفضل بالدخول.',
    repeat: 'بنكرر النداء على رقم {n}، اتفضل بالدخول.',
    recall: 'المريض صاحب رقم {n}، اتفضل بالدخول.',
  },
  formal: {
    call: 'رقم {n}، برجاء التوجه إلى {room}.',
    repeat: 'بنكرر النداء على رقم {n}، برجاء التوجه إلى {room}.',
    recall: 'المريض صاحب رقم {n}، برجاء التوجه إلى {room}.',
  },
  namePrefix: '{name}، ',
};

export const DEFAULT_DISPLAY: DisplaySettings = {
  title: 'عيادة الأستاذ الدكتور على قطب على',
  subtitle: 'أستاذ جراحة المخ والأعصاب – جامعة عين شمس',
  ticker: 'برجاء متابعة الشاشة والاستماع للنداء • نتمنى لكم دوام الصحة والعافية',
  digits: 'arabic',
};

export function mergeSettings(row: any, clinicId: string): ClinicSettings {
  const t = row?.templates ?? {};
  return {
    clinic_id: clinicId,
    policy: row?.policy ?? 'time',
    room_label: row?.room_label ?? 'غرفة الكشف',
    default_consult_minutes: row?.default_consult_minutes ?? 10,
    voice: { ...DEFAULT_VOICE, ...(row?.voice ?? {}) },
    templates: {
      standard: { ...DEFAULT_TEMPLATES.standard, ...(t.standard ?? {}) },
      formal: { ...DEFAULT_TEMPLATES.formal, ...(t.formal ?? {}) },
      namePrefix: t.namePrefix ?? DEFAULT_TEMPLATES.namePrefix,
    },
    display: { ...DEFAULT_DISPLAY, ...(row?.display ?? {}) },
  };
}

// ---- sheet configuration (stored in app_config.sheet) ----
export const FIELDS = ['booking_id', 'date', 'time', 'clinic', 'name', 'phone', 'action', 'status', 'call_no'] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABEL_AR: Record<Field, string> = {
  booking_id: 'معرف الحجز', date: 'التاريخ', time: 'الوقت', clinic: 'العيادة',
  name: 'الاسم', phone: 'رقم واتساب', action: 'الإجراء', status: 'حالة الحجز (اختياري)',
  call_no: 'رقم النداء الثابت (اختياري)',
};

export interface SheetConfig {
  tab: string;                                  // sheet/tab name; '' = first tab
  headerRow: number;                            // 1-based
  mapping: Partial<Record<Field, string>>;      // field → exact header text (override auto-detect)
  cancelKeywords: string[];
  dateOrder: 'dmy' | 'mdy';
  defaultClinic: string;                        // used when no clinic column exists
}

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  tab: 'QUEUE_TODAY',                          // Oracle-fed tab in WaitingListToday
  headerRow: 1,
  mapping: {},
  cancelKeywords: ['ملغي', 'ملغى', 'الغاء', 'إلغاء', 'اتلغى', 'cancel', 'cancelled', 'canceled'],
  dateOrder: 'dmy',
  defaultClinic: 'heliopolis',
};

export interface ClinicRef { id: string; name_ar: string; name_en: string; sheet_aliases: string[]; active: boolean; sort: number }
