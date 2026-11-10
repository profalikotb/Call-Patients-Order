import Admin from '@/components/Admin';
import { appMeta } from '@/lib/pwa';
export const metadata = appMeta('admin', '/admin', 'الإدارة');
export default function Page() { return <Admin />; }
