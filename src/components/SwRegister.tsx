'use client';
import { useEffect } from 'react';
export default function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
