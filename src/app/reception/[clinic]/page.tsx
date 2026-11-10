import Reception from '@/components/Reception';
import { appMeta } from '@/lib/pwa';
const AR: Record<string, string> = { heliopolis: 'مصر الجديدة', toukh: 'طوخ' };
export async function generateMetadata({ params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  return appMeta('reception', `/reception/${clinic}`, `الاستقبال ${AR[clinic] ?? ''}`.trim());
}
export default async function Page({ params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  return <Reception clinic={clinic} />;
}
