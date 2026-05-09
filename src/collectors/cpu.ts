import { promises as fs } from "fs";
import * as os from "os";
import { spawnWithTimeout } from "../exec";
import type { CollectorContext, CpuSample } from "./types";

interface CpuTimes {
  idle: number;
  total: number;
}

interface CpuState {
  prev?: CpuTimes;
}

export function createCpuCollector() {
  const state: CpuState = {};
  const platform = process.platform;

  async function sample(ctx: CollectorContext): Promise<CpuSample> {
    if (platform === "linux") {
      return sampleLinux(state, ctx);
    }
    if (platform === "darwin") {
      return sampleDarwin(ctx);
    }
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return { sample };
}

async function sampleLinux(state: CpuState, _ctx: CollectorContext): Promise<CpuSample> {
  const stat = await fs.readFile("/proc/stat", "utf8");
  const line = stat.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) throw new Error("/proc/stat missing aggregate cpu line");
  const parts = line.trim().split(/\s+/).slice(1).map((n) => parseInt(n, 10));
  // user nice system idle iowait irq softirq steal guest guest_nice
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0); // idle + iowait
  const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  let busyPct = 0;
  if (state.prev) {
    const dIdle = idle - state.prev.idle;
    const dTotal = total - state.prev.total;
    busyPct = dTotal > 0 ? (1 - dIdle / dTotal) * 100 : 0;
  }
  state.prev = { idle, total };

  const load = os.loadavg();
  return {
    busyPct,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    cores: os.cpus().length,
  };
}

async function sampleDarwin(ctx: CollectorContext): Promise<CpuSample> {
  // top -l 1 -n 0 outputs a header including a CPU usage line.
  const r = await spawnWithTimeout("top", ["-l", "1", "-n", "0"], ctx.commandTimeoutMs);
  const m = r.stdout.match(
    /CPU usage:\s+([\d.]+)% user,\s+([\d.]+)% sys,\s+([\d.]+)% idle/i,
  );
  let busyPct = 0;
  if (m) {
    const idle = parseFloat(m[3]);
    busyPct = 100 - idle;
  }
  const load = os.loadavg();
  return {
    busyPct,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    cores: os.cpus().length,
  };
}
