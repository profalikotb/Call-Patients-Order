import WaitingDisplay from '@/components/WaitingDisplay';
export const metadata = { title: 'شاشة الانتظار' };
export default async function Page({ params, searchParams }: { params: Promise<{ clinic: string }>; searchParams: Promise<Record<string, string>> }) {
  const { clinic } = await params;
  const sp = await searchParams;
  if (!sp.k) return <main className="grid h-dvh place-items-center bg-ink-950 text-white">رابط الشاشة ناقص (k). انسخه من الإعدادات ← الروابط.</main>;
  return <WaitingDisplay clinic={clinic} k={sp.k} label={(sp.label || 'شاشة الانتظار').slice(0, 60)} auto={sp.auto === '1'} />;
}
