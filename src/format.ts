const BYTE_UNITS = ["B", "K", "M", "G", "T", "P"];

export function humanBytes(n: number, decimals = 1): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  let i = 0;
  let v = n;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const d = i === 0 ? 0 : decimals;
  return `${v.toFixed(d)}${BYTE_UNITS[i]}`;
}

export function humanRate(bytesPerSec: number, decimals = 1): string {
  return `${humanBytes(bytesPerSec, decimals)}/s`;
}

export function percent(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "?";
  return `${n.toFixed(decimals)}%`;
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}
