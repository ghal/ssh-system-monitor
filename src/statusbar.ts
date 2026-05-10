import * as vscode from "vscode";
import type { Config, Thresholds } from "./config";
import { humanBytes, humanRate, pad, percent } from "./format";
import { buildTooltip } from "./detail";
import type { GpuSample, MetricKey, Snapshot } from "./collectors/types";

const COMMAND_MANAGE = "sshMonitor.manage";

const W_PCT = 4; // "100%"
const W_LOAD = 5; // "99.99"
const W_BYTES = 6; // "999.9G"
const W_RATE = 8; // "999.9M/s"

const ICONS: Record<MetricKey, string> = {
  cpu: "$(pulse)",
  memory: "$(database)",
  gpu: "$(server)",
  disk: "$(arrow-both)",
  network: "$(globe)",
};

const TEXT_LABELS: Record<MetricKey, string> = {
  cpu: "CPU",
  memory: "MEM",
  gpu: "GPU",
  disk: "DISK",
  network: "NET",
};

export class StatusBarManager implements vscode.Disposable {
  private items = new Map<MetricKey, vscode.StatusBarItem>();
  private cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.rebuild();
  }

  updateConfig(cfg: Config): void {
    this.cfg = cfg;
    this.rebuild();
  }

  render(snap: Snapshot): void {
    for (const [metric, item] of this.items) {
      const cfg = this.cfg;
      const text = renderText(metric, snap, cfg);
      const value = thresholdValue(metric, snap);
      item.text = text;
      item.tooltip = buildTooltip(metric, snap);
      item.backgroundColor = colorFor(value, this.thresholdsFor(metric), cfg.statusBar.colorize);
      item.show();
    }
  }

  showError(metric: MetricKey, err: string): void {
    const item = this.items.get(metric);
    if (!item) return;
    item.text = `${ICONS[metric]} !`;
    item.tooltip = new vscode.MarkdownString(`**${metric}** error\n\n\`\`\`\n${err}\n\`\`\``);
  }

  dispose(): void {
    for (const item of this.items.values()) item.dispose();
    this.items.clear();
  }

  private rebuild(): void {
    for (const item of this.items.values()) item.dispose();
    this.items.clear();
    if (!this.cfg.enabled) return;

    const align =
      this.cfg.statusBar.alignment === "left"
        ? vscode.StatusBarAlignment.Left
        : vscode.StatusBarAlignment.Right;
    const order = this.cfg.statusBar.order.filter((m) => this.metricEnabled(m));
    let priority = this.cfg.statusBar.priorityBase;
    for (const metric of order) {
      const item = vscode.window.createStatusBarItem(align, priority--);
      item.command = COMMAND_MANAGE;
      item.text = `${ICONS[metric]} —`;
      item.tooltip = `SSH Monitor: ${metric}`;
      item.show();
      this.items.set(metric, item);
    }
  }

  private metricEnabled(m: MetricKey): boolean {
    switch (m) {
      case "cpu":
        return this.cfg.metrics.cpu.enabled;
      case "memory":
        return this.cfg.metrics.memory.enabled;
      case "disk":
        return this.cfg.metrics.disk.enabled;
      case "network":
        return this.cfg.metrics.network.enabled;
      case "gpu":
        return this.cfg.metrics.gpu.enabled;
    }
  }

  private thresholdsFor(m: MetricKey): Thresholds | null {
    switch (m) {
      case "cpu":
        return this.cfg.thresholds.cpu;
      case "memory":
        return this.cfg.thresholds.memory;
      case "gpu":
        return this.cfg.thresholds.gpu;
      default:
        return null;
    }
  }
}

function thresholdValue(metric: MetricKey, snap: Snapshot): number | null {
  switch (metric) {
    case "cpu":
      return snap.cpu?.busyPct ?? null;
    case "memory":
      return snap.mem?.usedPct ?? null;
    case "gpu": {
      if (!snap.gpu || snap.gpu.devices.length === 0) return null;
      let max = 0;
      for (const d of snap.gpu.devices) {
        if (d.utilPct !== undefined && d.utilPct > max) max = d.utilPct;
      }
      return max;
    }
    default:
      return null;
  }
}

function colorFor(
  value: number | null,
  thresholds: Thresholds | null,
  colorize: boolean,
): vscode.ThemeColor | undefined {
  if (!colorize || value === null || thresholds === null) return undefined;
  if (value >= thresholds.crit) return new vscode.ThemeColor("statusBarItem.errorBackground");
  if (value >= thresholds.warn) return new vscode.ThemeColor("statusBarItem.warningBackground");
  return undefined;
}

function renderText(metric: MetricKey, snap: Snapshot, cfg: Config): string {
  const prefix = labelPrefix(metric, cfg.statusBar.iconStyle);
  switch (metric) {
    case "cpu":
      return `${prefix}${formatCpu(snap, cfg)}`;
    case "memory":
      return `${prefix}${formatMem(snap, cfg)}`;
    case "disk":
      return `${prefix}${formatDisk(snap, cfg)}`;
    case "network":
      return `${prefix}${formatNet(snap)}`;
    case "gpu":
      return `${prefix}${formatGpu(snap)}`;
  }
}

function labelPrefix(metric: MetricKey, style: Config["statusBar"]["iconStyle"]): string {
  if (style === "none") return "";
  if (style === "text") return `${TEXT_LABELS[metric]} `;
  return `${ICONS[metric]} `;
}

function formatCpu(snap: Snapshot, cfg: Config): string {
  const c = snap.cpu;
  if (!c) return pad("—", W_PCT);
  const fmt = cfg.metrics.cpu.format;
  const pct = percent(c.busyPct, 0, W_PCT);
  const load = pad(c.load1 !== undefined ? c.load1.toFixed(2) : "?", W_LOAD);
  if (fmt === "percent") return pct;
  if (fmt === "load") return load;
  return `${pct} (${load})`;
}

function formatMem(snap: Snapshot, cfg: Config): string {
  const m = snap.mem;
  if (!m) return pad("—", W_PCT);
  const fmt = cfg.metrics.memory.format;
  const pct = percent(m.usedPct, 0, W_PCT);
  const used = `${humanBytes(m.usedBytes, 1, W_BYTES)}/${humanBytes(m.totalBytes, 1, W_BYTES)}`;
  if (fmt === "percent") return pct;
  if (fmt === "used") return used;
  return `${used} (${pct})`;
}

function formatDisk(snap: Snapshot, cfg: Config): string {
  const d = snap.disk;
  if (!d) return pad("—", W_RATE);
  if (cfg.metrics.disk.showSeparateRW) {
    return `R ${humanRate(d.totalReadBps, 1, W_RATE)} W ${humanRate(d.totalWriteBps, 1, W_RATE)}`;
  }
  return humanRate(d.totalReadBps + d.totalWriteBps, 1, W_RATE);
}

function formatNet(snap: Snapshot): string {
  const n = snap.net;
  if (!n) return pad("—", W_RATE);
  return `↓${humanRate(n.totalRxBps, 1, W_RATE)} ↑${humanRate(n.totalTxBps, 1, W_RATE)}`;
}

function formatGpu(snap: Snapshot): string {
  const g: GpuSample | undefined = snap.gpu;
  if (!g || g.devices.length === 0) return pad("—", W_PCT);
  const utils = g.devices.map((d) => (d.utilPct !== undefined ? d.utilPct : null));
  if (utils.every((u) => u === null)) return pad("—", W_PCT);
  if (utils.length <= 2) {
    return utils.map((u) => (u === null ? pad("?", W_PCT) : percent(u, 0, W_PCT))).join("/");
  }
  const valid = utils.filter((u): u is number => u !== null);
  const avg = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
  return `avg ${percent(avg, 0, W_PCT)}`;
}
