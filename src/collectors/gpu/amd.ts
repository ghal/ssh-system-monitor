import { spawnWithTimeout } from "../../exec";
import type { CollectorContext, GpuDevice } from "../types";

export async function sampleAmd(ctx: CollectorContext): Promise<GpuDevice[]> {
  const r = await spawnWithTimeout(
    "rocm-smi",
    ["--showuse", "--showmemuse", "--showmeminfo", "vram", "--showtemp", "--showpower", "--showproductname", "--json"],
    ctx.commandTimeoutMs,
  );
  let data: Record<string, Record<string, string>>;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return [];
  }
  const out: GpuDevice[] = [];
  for (const [card, fields] of Object.entries(data)) {
    const m = card.match(/(\d+)$/);
    const index = m ? parseInt(m[1], 10) : out.length;
    const utilPct = num(fields["GPU use (%)"]);
    const memUsedBytes = num(fields["VRAM Total Used Memory (B)"]);
    const memTotalBytes = num(fields["VRAM Total Memory (B)"]);
    const tempC = num(fields["Temperature (Sensor edge) (C)"]) ?? num(fields["Temperature (Sensor junction) (C)"]);
    const powerW = num(fields["Average Graphics Package Power (W)"]) ?? num(fields["Current Socket Graphics Package Power (W)"]);
    const name = fields["Card series"] ?? fields["Card model"];
    out.push({
      vendor: "amd",
      index,
      name,
      utilPct,
      memUsedBytes,
      memTotalBytes,
      memPct: memUsedBytes !== undefined && memTotalBytes !== undefined && memTotalBytes > 0
        ? (memUsedBytes / memTotalBytes) * 100
        : undefined,
      tempC,
      powerW,
    });
  }
  return out;
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseFloat(String(s).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
