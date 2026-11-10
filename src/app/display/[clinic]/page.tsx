import WaitingDisplay from '@/components/WaitingDisplay';
import { appMeta } from '@/lib/pwa';
const AR: Record<string, string> = { heliopolis: 'مصر الجديدة', toukh: 'طوخ' };
type P = { params: Promise<{ clinic: string }>; searchParams: Promise<Record<string, string>> };
export async function generateMetadata({ params, searchParams }: P) {
  const { clinic } = await params;
  const sp = await searchParams;
  // the installed TV app opens with its key, sound activation (auto=1) included
  const q = new URLSearchParams({ k: sp.k ?? '', ...(sp.label ? { label: sp.label } : {}), auto: '1' });
  return appMeta('display', `/display/${clinic}?${q}`, `شاشة الانتظار ${AR[clinic] ?? ''}`.trim());
}
export default async function Page({ params, searchParams }: P) {
  const { clinic } = await params;
  const sp = await searchParams;
  if (!sp.k) return <main className="grid h-dvh place-items-center bg-ink-950 text-white">رابط الشاشة ناقص (k). انسخه من الإعدادات ← الروابط.</main>;
  return <WaitingDisplay clinic={clinic} k={sp.k} label={(sp.label || 'شاشة الانتظار').slice(0, 60)} auto={sp.auto === '1'} />;
}
