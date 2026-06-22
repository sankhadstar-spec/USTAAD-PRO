// A random, persistent anonymous identity for this browser/device, used to
// key real rows in Supabase. Not a real login — see the security note at
// the top of supabase_schema.sql for what that does and doesn't protect.

const KEY = 'ustaad_device_id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
