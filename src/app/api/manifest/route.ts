// Per-page install manifest: each page installs as its OWN app (own icon, own name, opens straight on that page).
//   /api/manifest?app=reception&start=/reception/heliopolis
export const runtime = 'nodejs';

const APPS: Record<string, { name: string; short: string; bg: string; theme: string; orientation: string }> = {
  admin:     { name: 'الإدارة – الدور الذكي', short: 'الإدارة', bg: '#0b1a2e', theme: '#0b1a2e', orientation: 'any' },
  reception: { name: 'الاستقبال – الدور الذكي', short: 'الاستقبال', bg: '#f8fafc', theme: '#0b1a2e', orientation: 'any' },
  display:   { name: 'شاشة الانتظار', short: 'شاشة الانتظار', bg: '#07111f', theme: '#07111f', orientation: 'landscape' },
  doctor:    { name: 'رسائل الطبيب للمساعد', short: 'رسائل الطبيب', bg: '#f8fafc', theme: '#059669', orientation: 'portrait' },
};
const CLINIC_AR: Record<string, string> = { heliopolis: 'مصر الجديدة', toukh: 'طوخ' };

export async function GET(req: Request) {
  const u = new URL(req.url);
  const app = APPS[u.searchParams.get('app') ?? ''] ? u.searchParams.get('app')! : 'reception';
  const a = APPS[app];
  let start = u.searchParams.get('start') || '/';
  if (!start.startsWith('/') || start.startsWith('//')) start = '/';          // same-site only
  const clinic = start.split('/')[2]?.split('?')[0] ?? '';
  const place = CLINIC_AR[clinic] ? ` – ${CLINIC_AR[clinic]}` : '';
  const m = {
    id: start.split('?')[0],                                                    // separate app per page
    name: a.name + place, short_name: a.short + (CLINIC_AR[clinic] ? ` ${CLINIC_AR[clinic]}` : ''),
    start_url: start, scope: '/', display: 'standalone', orientation: a.orientation,
    dir: 'rtl', lang: 'ar', background_color: a.bg, theme_color: a.theme,
    icons: [
      { src: `/apps/${app}-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `/apps/${app}-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `/apps/${app}-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' } });
}
