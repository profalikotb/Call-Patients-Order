/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // friendly spellings → real clinic ids (toukh / heliopolis)
  async redirects() {
    const alias = { tukh: 'toukh', tokh: 'toukh', touk: 'toukh', masr: 'heliopolis', heliopoli: 'heliopolis', 'misr': 'heliopolis' };
    return ['reception', 'doctor', 'display', 'summary'].flatMap((p) =>
      Object.entries(alias).map(([a, id]) => ({ source: `/${p}/${a}`, destination: `/${p}/${id}`, permanent: false })));
  },
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/(.*)', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },   // mic: doctor voice notes
      ] },
    ];
  },
};
export default nextConfig;
