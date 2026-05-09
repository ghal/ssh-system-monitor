import { spawnWithTimeout } from "../../exec";
import type { CollectorContext, GpuDevice } from "../types";

const FIELDS = "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw";

export async function sampleNvidia(ctx: CollectorContext): Promise<GpuDevice[]> {
  const r = await spawnWithTimeout(
    "nvidia-smi",
    [`--query-gpu=${FIELDS}`, "--format=csv,noheader,nounits"],
    ctx.commandTimeoutMs,
  );
  const out: GpuDevice[] = [];
  for (const line of r.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length < 7) continue;
    const index = parseInt(parts[0], 10);
    const name = parts[1];
    const util = parseFloat(parts[2]);
    const memUsedMB = parseFloat(parts[3]);
    const memTotalMB = parseFloat(parts[4]);
    const tempC = parseFloat(parts[5]);
    const powerW = parseFloat(parts[6]);
    const memUsedBytes = memUsedMB * 1024 * 1024;
    const memTotalBytes = memTotalMB * 1024 * 1024;
    out.push({
      vendor: "nvidia",
      index,
      name,
      utilPct: numOrUndef(util),
      memUsedBytes: numOrUndef(memUsedBytes),
      memTotalBytes: numOrUndef(memTotalBytes),
      memPct: memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : undefined,
      tempC: numOrUndef(tempC),
      powerW: numOrUndef(powerW),
    });
  }
  return out;
}

function numOrUndef(n: number): number | undefined {
  return Number.isFinite(n) ? n : undefined;
}
