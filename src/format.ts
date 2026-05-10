const BYTE_UNITS = ["B", "K", "M", "G", "T", "P"];

const PAD_CHAR = " "; // figure space — same width as a digit in tabular fonts

export function humanBytes(n: number, decimals = 1, width = 0): string {
  if (!Number.isFinite(n) || n < 0) return pad("?", width);
  let i = 0;
  let v = n;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const d = i === 0 ? 0 : decimals;
  return pad(`${v.toFixed(d)}${BYTE_UNITS[i]}`, width);
}

export function humanRate(bytesPerSec: number, decimals = 1, width = 0): string {
  return pad(`${humanBytes(bytesPerSec, decimals)}/s`, width);
}

export function percent(n: number, decimals = 0, width = 0): string {
  if (!Number.isFinite(n)) return pad("?", width);
  return pad(`${n.toFixed(decimals)}%`, width);
}

export function pad(s: string, width: number): string {
  if (width <= 0 || s.length >= width) return s;
  return PAD_CHAR.repeat(width - s.length) + s;
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}
