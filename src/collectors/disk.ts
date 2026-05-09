import { promises as fs } from "fs";
import { spawnWithTimeout } from "../exec";
import type { CollectorContext, DiskDevice, DiskSample } from "./types";

const SECTOR_SIZE = 512;

interface RawCounter {
  readBytes: number;
  writeBytes: number;
  ts: number;
}

interface DiskState {
  prev: Map<string, RawCounter>;
}

export function createDiskCollector() {
  const state: DiskState = { prev: new Map() };
  const platform = process.platform;

  async function sample(ctx: CollectorContext): Promise<DiskSample> {
    const raw = platform === "linux" ? await readLinux() : await readDarwin(ctx);
    const now = Date.now();
    const devices: DiskDevice[] = [];
    let totalRead = 0;
    let totalWrite = 0;

    for (const [name, cur] of raw) {
      if (!ctx.diskFilter(name)) {
        state.prev.delete(name);
        continue;
      }
      const prev = state.prev.get(name);
      state.prev.set(name, { ...cur, ts: now });
      if (!prev) continue;
      const dt = (now - prev.ts) / 1000;
      if (dt <= 0) continue;
      const readBps = Math.max(0, (cur.readBytes - prev.readBytes) / dt);
      const writeBps = Math.max(0, (cur.writeBytes - prev.writeBytes) / dt);
      devices.push({ name, readBps, writeBps });
      totalRead += readBps;
      totalWrite += writeBps;
    }
    devices.sort((a, b) => b.readBps + b.writeBps - (a.readBps + a.writeBps));
    return { totalReadBps: totalRead, totalWriteBps: totalWrite, devices };
  }

  return { sample };
}

async function readLinux(): Promise<Map<string, Omit<RawCounter, "ts">>> {
  const text = await fs.readFile("/proc/diskstats", "utf8");
  const out = new Map<string, Omit<RawCounter, "ts">>();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 14) continue;
    const name = parts[2];
    // field 6 (index 5): sectors read; field 10 (index 9): sectors written
    const readSectors = parseInt(parts[5], 10);
    const writeSectors = parseInt(parts[9], 10);
    if (!Number.isFinite(readSectors) || !Number.isFinite(writeSectors)) continue;
    out.set(name, {
      readBytes: readSectors * SECTOR_SIZE,
      writeBytes: writeSectors * SECTOR_SIZE,
    });
  }
  return out;
}

async function readDarwin(ctx: CollectorContext): Promise<Map<string, Omit<RawCounter, "ts">>> {
  // iostat -dIw 0 emits cumulative KB/transfer columns; -I gives totals since boot.
  // Format: device  KB/t  xfrs  MB     KB/t  xfrs  MB ...
  // Simpler: iostat -Id <devs> not portable. Use -dI which prints all devices.
  const r = await spawnWithTimeout("iostat", ["-dI"], ctx.commandTimeoutMs);
  const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
  // header line 0: device names; line 1: column labels (KB/t xfrs MB per device); line 2: values.
  if (lines.length < 3) return new Map();
  const devNames = lines[0].trim().split(/\s+/);
  const values = lines[2].trim().split(/\s+/).map((n) => parseFloat(n));
  const out = new Map<string, Omit<RawCounter, "ts">>();
  // For each device, three columns: KB/t, xfrs, MB(total). We treat MB total as cumulative bytes transferred.
  // iostat does not split read vs write on macOS without -x; approximate read = write = total/2 as fallback.
  for (let i = 0; i < devNames.length; i++) {
    const totalMB = values[i * 3 + 2];
    if (!Number.isFinite(totalMB)) continue;
    const totalBytes = totalMB * 1024 * 1024;
    out.set(devNames[i], {
      readBytes: totalBytes / 2,
      writeBytes: totalBytes / 2,
    });
  }
  return out;
}
