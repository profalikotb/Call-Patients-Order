// Tolerant reading of copy-pasted secrets: trims spaces / line breaks, strips quotes and a "Bearer " prefix.
export function clean(v: string | undefined | null): string {
  let s = String(v ?? '').replace(/[​-‏﻿]/g, '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  s = s.replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
  return s;
}
/** Project URL: also drops trailing "/", "/rest/v1" etc. */
export function cleanUrl(v: string | undefined | null): string {
  return clean(v).replace(/\/(rest|auth|realtime|storage)\/v1.*$/i, '').replace(/\/+$/, '');
}
