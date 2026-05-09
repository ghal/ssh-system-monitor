import { promises as fs } from "fs";
import { spawnWithTimeout } from "../exec";
import type { CollectorContext, NetDevice, NetSample } from "./types";

interface RawCounter {
  rx: number;
  tx: number;
  ts: number;
}

interface NetState {
  prev: Map<string, RawCounter>;
}

export function createNetCollector() {
  const state: NetState = { prev: new Map() };
  const platform = process.platform;

  async function sample(ctx: CollectorContext): Promise<NetSample> {
    const raw = platform === "linux" ? await readLinux() : await readDarwin(ctx);
    const now = Date.now();
    const devices: NetDevice[] = [];
    let totalRx = 0;
    let totalTx = 0;

    for (const [name, cur] of raw) {
      if (!ctx.netFilter(name)) {
        state.prev.delete(name);
        continue;
      }
      const prev = state.prev.get(name);
      state.prev.set(name, { ...cur, ts: now });
      if (!prev) continue;
      const dt = (now - prev.ts) / 1000;
      if (dt <= 0) continue;
      const rxBps = Math.max(0, (cur.rx - prev.rx) / dt);
      const txBps = Math.max(0, (cur.tx - prev.tx) / dt);
      devices.push({ name, rxBps, txBps });
      totalRx += rxBps;
      totalTx += txBps;
    }
    devices.sort((a, b) => b.rxBps + b.txBps - (a.rxBps + a.txBps));
    return { totalRxBps: totalRx, totalTxBps: totalTx, devices };
  }

  return { sample };
}

async function readLinux(): Promise<Map<string, Omit<RawCounter, "ts">>> {
  const text = await fs.readFile("/proc/net/dev", "utf8");
  const out = new Map<string, Omit<RawCounter, "ts">>();
  const lines = text.split("\n");
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    const fields = line.slice(colon + 1).trim().split(/\s+/).map((n) => parseInt(n, 10));
    if (fields.length < 16) continue;
    const rx = fields[0];
    const tx = fields[8];
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
    out.set(name, { rx, tx });
  }
  return out;
}

async function readDarwin(ctx: CollectorContext): Promise<Map<string, Omit<RawCounter, "ts">>> {
  // netstat -ibn columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
  const r = await spawnWithTimeout("netstat", ["-ibn"], ctx.commandTimeoutMs);
  const lines = r.stdout.split("\n");
  if (lines.length < 2) return new Map();
  const out = new Map<string, Omit<RawCounter, "ts">>();
  // Skip header; aggregate per interface (multiple address rows can appear).
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 10) continue;
    const name = parts[0];
    const ibytes = parseInt(parts[6], 10);
    const obytes = parseInt(parts[9], 10);
    if (!Number.isFinite(ibytes) || !Number.isFinite(obytes)) continue;
    if (out.has(name)) continue; // first row per interface has the totals
    out.set(name, { rx: ibytes, tx: obytes });
  }
  return out;
}
