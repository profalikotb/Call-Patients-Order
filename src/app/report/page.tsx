import Report from '@/components/Report';
import { appMeta } from '@/lib/pwa';
export const metadata = appMeta('admin', '/report', 'التقرير الشهري');
export default function Page() { return <Report />; }
