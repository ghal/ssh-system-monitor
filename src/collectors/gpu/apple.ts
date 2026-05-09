import { spawnWithTimeout } from "../../exec";
import type { CollectorContext, GpuDevice } from "../types";

export async function sampleApple(ctx: CollectorContext): Promise<GpuDevice[]> {
  const sudo = ctx.gpu.appleSudoCommand.trim();
  if (!sudo) {
    // Apple Silicon GPU sampling needs sudo; surface no-op when not configured.
    return [];
  }
  const sudoParts = sudo.split(/\s+/);
  const cmd = sudoParts[0];
  const args = [
    ...sudoParts.slice(1),
    "powermetrics",
    "--samplers",
    "gpu_power",
    "-i",
    String(Math.max(ctx.intervalMs, 500)),
    "-n",
    "1",
  ];
  const r = await spawnWithTimeout(cmd, args, Math.max(ctx.commandTimeoutMs, ctx.intervalMs + 1000));
  const text = r.stdout;
  // Lines of interest:
  //   GPU HW active frequency: 444 MHz
  //   GPU HW active residency:  31.20% (...)
  //   GPU SW requested state: ...
  //   GPU idle residency:  68.80%
  //   GPU Power: 1234 mW
  const activeMatch = text.match(/GPU HW active residency:\s+([\d.]+)%/i);
  const idleMatch = text.match(/GPU idle residency:\s+([\d.]+)%/i);
  const powerMatch = text.match(/GPU Power:\s+([\d.]+)\s*mW/i);
  let utilPct: number | undefined;
  if (activeMatch) {
    utilPct = parseFloat(activeMatch[1]);
  } else if (idleMatch) {
    utilPct = 100 - parseFloat(idleMatch[1]);
  }
  const powerW = powerMatch ? parseFloat(powerMatch[1]) / 1000 : undefined;
  return [
    {
      vendor: "apple",
      index: 0,
      utilPct,
      powerW,
    },
  ];
}
