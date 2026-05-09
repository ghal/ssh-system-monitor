import { promises as fs } from "fs";
import { spawnWithTimeout } from "../exec";
import type { CollectorContext, MemSample } from "./types";

export function createMemCollector() {
  const platform = process.platform;
  let pageSize: number | null = null;

  async function sample(ctx: CollectorContext): Promise<MemSample> {
    if (platform === "linux") return sampleLinux();
    if (platform === "darwin") {
      if (pageSize === null) pageSize = await getDarwinPageSize(ctx);
      return sampleDarwin(ctx, pageSize);
    }
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return { sample };
}

async function sampleLinux(): Promise<MemSample> {
  const text = await fs.readFile("/proc/meminfo", "utf8");
  const map = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z()_]+):\s+(\d+)\s*kB?/);
    if (m) map.set(m[1], parseInt(m[2], 10) * 1024);
  }
  const total = map.get("MemTotal") ?? 0;
  const available =
    map.get("MemAvailable") ?? (map.get("MemFree") ?? 0) + (map.get("Buffers") ?? 0) + (map.get("Cached") ?? 0);
  const used = Math.max(0, total - available);
  const usedPct = total > 0 ? (used / total) * 100 : 0;
  return { totalBytes: total, usedBytes: used, availableBytes: available, usedPct };
}

async function getDarwinPageSize(ctx: CollectorContext): Promise<number> {
  try {
    const r = await spawnWithTimeout("sysctl", ["-n", "hw.pagesize"], ctx.commandTimeoutMs);
    const n = parseInt(r.stdout.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 4096;
  } catch {
    return 4096;
  }
}

async function sampleDarwin(ctx: CollectorContext, pageSize: number): Promise<MemSample> {
  const [vm, total] = await Promise.all([
    spawnWithTimeout("vm_stat", [], ctx.commandTimeoutMs),
    spawnWithTimeout("sysctl", ["-n", "hw.memsize"], ctx.commandTimeoutMs),
  ]);
  const totalBytes = parseInt(total.stdout.trim(), 10) || 0;

  const counts = new Map<string, number>();
  for (const line of vm.stdout.split("\n")) {
    const m = line.match(/^([^:]+):\s+(\d+)\.?/);
    if (m) counts.set(m[1].trim(), parseInt(m[2], 10));
  }
  // "Used" approximation: app + wired + compressed.
  const active = counts.get("Pages active") ?? 0;
  const wired = counts.get("Pages wired down") ?? 0;
  const compressed = counts.get("Pages occupied by compressor") ?? 0;
  const speculative = counts.get("Pages speculative") ?? 0;
  const free = counts.get("Pages free") ?? 0;
  const inactive = counts.get("Pages inactive") ?? 0;

  const usedBytes = (active + wired + compressed) * pageSize;
  const availableBytes = (free + inactive + speculative) * pageSize;
  const usedPct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  return { totalBytes, usedBytes, availableBytes, usedPct };
}
