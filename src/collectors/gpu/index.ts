import { which } from "../../exec";
import type { CollectorContext, GpuDevice, GpuSample } from "../types";
import { sampleNvidia } from "./nvidia";
import { sampleAmd } from "./amd";
import { sampleIntel } from "./intel";
import { sampleApple } from "./apple";

type Vendor = "nvidia" | "amd" | "intel" | "apple";

interface VendorState {
  failures: number;
  disabled: boolean;
  lastError?: string;
}

const MAX_FAILURES = 3;

export function createGpuCollector() {
  let detection: Promise<Set<Vendor>> | null = null;
  const states: Record<Vendor, VendorState> = {
    nvidia: { failures: 0, disabled: false },
    amd: { failures: 0, disabled: false },
    intel: { failures: 0, disabled: false },
    apple: { failures: 0, disabled: false },
  };

  function resetVendorStates() {
    for (const k of Object.keys(states) as Vendor[]) {
      states[k].failures = 0;
      states[k].disabled = false;
      states[k].lastError = undefined;
    }
  }

  async function detect(ctx: CollectorContext): Promise<Set<Vendor>> {
    const requested = ctx.gpu.vendors;
    const auto = requested.includes("auto");
    const explicit = new Set<Vendor>(
      requested.filter((v): v is Vendor => v !== "auto"),
    );
    if (!auto) return explicit;

    const [nv, amd, intel] = await Promise.all([
      which("nvidia-smi"),
      which("rocm-smi"),
      which("intel_gpu_top"),
    ]);
    if (nv) explicit.add("nvidia");
    if (amd) explicit.add("amd");
    if (intel) explicit.add("intel");
    if (process.platform === "darwin" && ctx.gpu.appleSudoCommand.trim()) {
      explicit.add("apple");
    }
    return explicit;
  }

  async function sample(ctx: CollectorContext): Promise<GpuSample> {
    if (!detection) detection = detect(ctx);
    const vendors = await detection;

    const tasks: Array<Promise<GpuDevice[]>> = [];
    for (const v of vendors) {
      if (states[v].disabled) continue;
      tasks.push(runVendor(v, ctx, states[v]));
    }
    const results = await Promise.all(tasks);
    const devices = results.flat();
    return { devices };
  }

  function setVendors(vs: Array<"auto" | Vendor>) {
    detection = null; // re-detect on next sample
    if (vs.length > 0) resetVendorStates();
  }

  function diagnostics(): string[] {
    const out: string[] = [];
    for (const [v, s] of Object.entries(states)) {
      if (s.disabled) {
        out.push(`${v}: disabled after ${MAX_FAILURES} failures (${s.lastError ?? "unknown"})`);
      } else if (s.failures > 0) {
        out.push(`${v}: ${s.failures} consecutive failures (${s.lastError ?? "unknown"})`);
      }
    }
    return out;
  }

  return { sample, setVendors, diagnostics };
}

async function runVendor(vendor: Vendor, ctx: CollectorContext, state: VendorState): Promise<GpuDevice[]> {
  try {
    const devices = await runner(vendor)(ctx);
    state.failures = 0;
    state.lastError = undefined;
    return devices;
  } catch (err) {
    state.failures++;
    state.lastError = err instanceof Error ? err.message : String(err);
    if (state.failures >= MAX_FAILURES) {
      state.disabled = true;
      ctx.log(`gpu/${vendor}: disabled after ${MAX_FAILURES} failures: ${state.lastError}`);
    }
    return [];
  }
}

function runner(v: Vendor) {
  switch (v) {
    case "nvidia":
      return sampleNvidia;
    case "amd":
      return sampleAmd;
    case "intel":
      return sampleIntel;
    case "apple":
      return sampleApple;
  }
}
