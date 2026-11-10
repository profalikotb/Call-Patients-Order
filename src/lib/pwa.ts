import type { Metadata } from 'next';
// metadata that makes a page installable as its own app (desktop: Edge/Chrome «Install»; iPhone: Add to Home Screen)
export function appMeta(app: 'admin' | 'reception' | 'display' | 'doctor', start: string, title: string): Metadata {
  return {
    title,
    manifest: `/api/manifest?app=${app}&start=${encodeURIComponent(start)}`,
    appleWebApp: { capable: true, title, statusBarStyle: 'black-translucent' },
    icons: { icon: `/apps/${app}-192.png`, apple: `/apps/${app}-apple-180.png` },
  };
}
