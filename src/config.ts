import * as vscode from "vscode";
import type { MetricKey } from "./collectors/types";

export type StatusBarAlignment = "left" | "right";
export type IconStyle = "codicon" | "text" | "none";
export type CpuFormat = "percent" | "load" | "both";
export type MemFormat = "percent" | "used" | "both";
export type GpuVendor = "auto" | "nvidia" | "amd" | "intel" | "apple";
export type GpuMetric = "util" | "mem" | "temp" | "power";

export interface Thresholds {
  warn: number;
  crit: number;
}

export interface Config {
  enabled: boolean;
  intervalMs: number;
  commandTimeoutMs: number;
  runOnLocal: boolean;
  statusBar: {
    alignment: StatusBarAlignment;
    priorityBase: number;
    order: MetricKey[];
    colorize: boolean;
    iconStyle: IconStyle;
  };
  metrics: {
    cpu: { enabled: boolean; format: CpuFormat };
    memory: { enabled: boolean; format: MemFormat };
    disk: {
      enabled: boolean;
      includePattern: string;
      excludePattern: string;
      showSeparateRW: boolean;
    };
    network: {
      enabled: boolean;
      includePattern: string;
      excludePattern: string;
    };
    gpu: {
      enabled: boolean;
      vendors: GpuVendor[];
      show: GpuMetric[];
      apple: { sudoCommand: string };
    };
  };
  thresholds: {
    cpu: Thresholds;
    memory: Thresholds;
    gpu: Thresholds;
  };
}

const VALID_METRICS: MetricKey[] = ["cpu", "memory", "gpu", "disk", "network"];

export function readConfig(): Config {
  const c = vscode.workspace.getConfiguration("sshMonitor");
  const orderRaw = c.get<string[]>("statusBar.order", ["cpu", "memory", "gpu", "disk", "network"]);
  const order = orderRaw.filter((x): x is MetricKey =>
    (VALID_METRICS as string[]).includes(x),
  );

  return {
    enabled: c.get<boolean>("enabled", true),
    intervalMs: clamp(c.get<number>("intervalMs", 2000), 500, 60000),
    commandTimeoutMs: clamp(c.get<number>("commandTimeoutMs", 1500), 200, 30000),
    runOnLocal: c.get<boolean>("runOnLocal", false),
    statusBar: {
      alignment: c.get<StatusBarAlignment>("statusBar.alignment", "right"),
      priorityBase: c.get<number>("statusBar.priorityBase", 100),
      order,
      colorize: c.get<boolean>("statusBar.colorize", true),
      iconStyle: c.get<IconStyle>("statusBar.iconStyle", "codicon"),
    },
    metrics: {
      cpu: {
        enabled: c.get<boolean>("metrics.cpu.enabled", true),
        format: c.get<CpuFormat>("metrics.cpu.format", "percent"),
      },
      memory: {
        enabled: c.get<boolean>("metrics.memory.enabled", true),
        format: c.get<MemFormat>("metrics.memory.format", "both"),
      },
      disk: {
        enabled: c.get<boolean>("metrics.disk.enabled", true),
        includePattern: c.get<string>("metrics.disk.includePattern", ""),
        excludePattern: c.get<string>("metrics.disk.excludePattern", "^(loop|ram|sr|fd|dm-)"),
        showSeparateRW: c.get<boolean>("metrics.disk.showSeparateRW", true),
      },
      network: {
        enabled: c.get<boolean>("metrics.network.enabled", true),
        includePattern: c.get<string>("metrics.network.includePattern", ""),
        excludePattern: c.get<string>(
          "metrics.network.excludePattern",
          "^(lo|docker|veth|br-|cni|utun|awdl|llw|anpi|ap1|bridge|gif|stf)",
        ),
      },
      gpu: {
        enabled: c.get<boolean>("metrics.gpu.enabled", true),
        vendors: c.get<GpuVendor[]>("metrics.gpu.vendors", ["auto"]),
        show: c.get<GpuMetric[]>("metrics.gpu.show", ["util", "mem"]),
        apple: {
          sudoCommand: c.get<string>("metrics.gpu.apple.sudoCommand", ""),
        },
      },
    },
    thresholds: {
      cpu: {
        warn: c.get<number>("thresholds.cpu.warn", 70),
        crit: c.get<number>("thresholds.cpu.crit", 90),
      },
      memory: {
        warn: c.get<number>("thresholds.memory.warn", 75),
        crit: c.get<number>("thresholds.memory.crit", 92),
      },
      gpu: {
        warn: c.get<number>("thresholds.gpu.warn", 70),
        crit: c.get<number>("thresholds.gpu.crit", 90),
      },
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function compileFilter(includePattern: string, excludePattern: string): (name: string) => boolean {
  const inc = includePattern ? safeRegex(includePattern) : null;
  const exc = excludePattern ? safeRegex(excludePattern) : null;
  return (name: string) => {
    if (inc && !inc.test(name)) return false;
    if (exc && exc.test(name)) return false;
    return true;
  };
}

function safeRegex(src: string): RegExp | null {
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}
