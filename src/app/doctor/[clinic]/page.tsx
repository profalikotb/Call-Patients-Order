import DoctorPad from '@/components/DoctorPad';
import { appMeta } from '@/lib/pwa';
const AR: Record<string, string> = { heliopolis: 'مصر الجديدة', toukh: 'طوخ' };
export async function generateMetadata({ params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  return appMeta('doctor', `/doctor/${clinic}`, `رسائل الطبيب ${AR[clinic] ?? ''}`.trim());
}
export default async function Page({ params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  return <DoctorPad clinic={clinic} />;
}
