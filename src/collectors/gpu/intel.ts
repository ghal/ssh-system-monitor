import { spawn } from "child_process";
import type { CollectorContext, GpuDevice } from "../types";

export async function sampleIntel(ctx: CollectorContext): Promise<GpuDevice[]> {
  // intel_gpu_top -J emits a JSON array that never closes until SIGINT.
  // Strategy: read for slightly longer than one sampling interval, kill, parse the first object.
  const sampleWindowMs = Math.min(Math.max(ctx.intervalMs, 500), ctx.commandTimeoutMs);
  return await new Promise<GpuDevice[]>((resolve) => {
    const child = spawn("intel_gpu_top", ["-J", "-s", String(sampleWindowMs)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let resolved = false;

    const finish = (devices: GpuDevice[]) => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve(devices);
    };

    const timer = setTimeout(() => finish(parseSamples(buf)), sampleWindowMs * 2 + 250);

    child.stdout.on("data", (b: Buffer) => {
      buf += b.toString();
      const samples = parseSamples(buf);
      if (samples.length > 0) {
        clearTimeout(timer);
        finish(samples);
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish([]);
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish(parseSamples(buf));
    });
  });
}

function parseSamples(buf: string): GpuDevice[] {
  // Stream begins with `[\n` then `{...},\n` per sample. Find first complete top-level object.
  const start = buf.indexOf("{");
  if (start < 0) return [];
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        const obj = buf.slice(start, i + 1);
        try {
          const parsed = JSON.parse(obj);
          return objectToDevices(parsed);
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function objectToDevices(obj: unknown): GpuDevice[] {
  if (!obj || typeof obj !== "object") return [];
  const o = obj as Record<string, unknown>;
  const engines = o["engines"] as Record<string, { busy?: number }> | undefined;
  let busiest = 0;
  if (engines) {
    for (const v of Object.values(engines)) {
      if (v && typeof v.busy === "number" && v.busy > busiest) busiest = v.busy;
    }
  }
  const power = o["power"] as { Package?: number; GPU?: number } | undefined;
  const powerW = typeof power?.GPU === "number" ? power.GPU : typeof power?.Package === "number" ? power.Package : undefined;
  return [
    {
      vendor: "intel",
      index: 0,
      utilPct: busiest,
      powerW,
    },
  ];
}
