import * as vscode from "vscode";
import { humanBytes, humanRate, percent } from "./format";
import type { MetricKey, Snapshot } from "./collectors/types";

export function buildTooltip(metric: MetricKey, snap: Snapshot | null): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportThemeIcons = true;
  if (!snap) {
    md.appendMarkdown("**SSH System Monitor**\n\nNo sample yet.");
    return md;
  }
  md.appendMarkdown(`**SSH System Monitor — ${metric.toUpperCase()}**  \n`);
  switch (metric) {
    case "cpu":
      tooltipCpu(md, snap);
      break;
    case "memory":
      tooltipMem(md, snap);
      break;
    case "disk":
      tooltipDisk(md, snap);
      break;
    case "network":
      tooltipNet(md, snap);
      break;
    case "gpu":
      tooltipGpu(md, snap);
      break;
  }
  if (snap.errors[metric]) {
    md.appendMarkdown(`\n\n_error: ${escapeMd(snap.errors[metric]!)}_`);
  }
  md.appendMarkdown(`\n\n_Click for full details._`);
  return md;
}

function tooltipCpu(md: vscode.MarkdownString, snap: Snapshot): void {
  const c = snap.cpu;
  if (!c) {
    md.appendMarkdown("_no data_");
    return;
  }
  md.appendMarkdown(`Busy: **${percent(c.busyPct, 1)}**  \n`);
  if (c.load1 !== undefined) {
    md.appendMarkdown(
      `Load: ${c.load1.toFixed(2)} / ${c.load5?.toFixed(2) ?? "?"} / ${c.load15?.toFixed(2) ?? "?"}  \n`,
    );
  }
  if (c.cores) md.appendMarkdown(`Cores: ${c.cores}  \n`);
}

function tooltipMem(md: vscode.MarkdownString, snap: Snapshot): void {
  const m = snap.mem;
  if (!m) {
    md.appendMarkdown("_no data_");
    return;
  }
  md.appendMarkdown(
    `Used: **${humanBytes(m.usedBytes)}** / ${humanBytes(m.totalBytes)} (${percent(m.usedPct, 1)})  \n`,
  );
  md.appendMarkdown(`Available: ${humanBytes(m.availableBytes)}  \n`);
}

function tooltipDisk(md: vscode.MarkdownString, snap: Snapshot): void {
  const d = snap.disk;
  if (!d) {
    md.appendMarkdown("_no data_");
    return;
  }
  md.appendMarkdown(
    `Total: **R ${humanRate(d.totalReadBps)}** / **W ${humanRate(d.totalWriteBps)}**  \n`,
  );
  if (d.devices.length) {
    md.appendMarkdown(`\n| device | read | write |\n|---|---:|---:|\n`);
    for (const dev of d.devices.slice(0, 12)) {
      md.appendMarkdown(`| ${escapeMd(dev.name)} | ${humanRate(dev.readBps)} | ${humanRate(dev.writeBps)} |\n`);
    }
  }
}

function tooltipNet(md: vscode.MarkdownString, snap: Snapshot): void {
  const n = snap.net;
  if (!n) {
    md.appendMarkdown("_no data_");
    return;
  }
  md.appendMarkdown(
    `Total: **↓ ${humanRate(n.totalRxBps)}** / **↑ ${humanRate(n.totalTxBps)}**  \n`,
  );
  if (n.devices.length) {
    md.appendMarkdown(`\n| iface | rx | tx |\n|---|---:|---:|\n`);
    for (const dev of n.devices.slice(0, 12)) {
      md.appendMarkdown(`| ${escapeMd(dev.name)} | ${humanRate(dev.rxBps)} | ${humanRate(dev.txBps)} |\n`);
    }
  }
}

function tooltipGpu(md: vscode.MarkdownString, snap: Snapshot): void {
  const g = snap.gpu;
  if (!g || g.devices.length === 0) {
    md.appendMarkdown("_no GPU data_");
    return;
  }
  md.appendMarkdown(`\n| # | vendor | name | util | mem | temp | power |\n|---|---|---|---:|---|---:|---:|\n`);
  for (const d of g.devices) {
    const memStr =
      d.memUsedBytes !== undefined && d.memTotalBytes !== undefined
        ? `${humanBytes(d.memUsedBytes)}/${humanBytes(d.memTotalBytes)}`
        : "—";
    md.appendMarkdown(
      `| ${d.index} | ${d.vendor} | ${escapeMd(d.name ?? "—")} | ${
        d.utilPct !== undefined ? percent(d.utilPct, 0) : "—"
      } | ${memStr} | ${d.tempC !== undefined ? `${d.tempC.toFixed(0)}°C` : "—"} | ${
        d.powerW !== undefined ? `${d.powerW.toFixed(0)}W` : "—"
      } |\n`,
    );
  }
}

export function renderDetailReport(snap: Snapshot | null, diagnostics: string[]): string {
  const lines: string[] = [];
  lines.push(`SSH System Monitor — ${new Date(snap?.ts ?? Date.now()).toISOString()}`);
  lines.push("=".repeat(60));
  if (!snap) {
    lines.push("No sample yet.");
    return lines.join("\n");
  }

  if (snap.cpu) {
    lines.push("[CPU]");
    lines.push(
      `  busy ${percent(snap.cpu.busyPct, 2)}  load ${snap.cpu.load1?.toFixed(2) ?? "?"} / ${snap.cpu.load5?.toFixed(2) ?? "?"} / ${snap.cpu.load15?.toFixed(2) ?? "?"}  cores ${snap.cpu.cores ?? "?"}`,
    );
  }
  if (snap.mem) {
    lines.push("[Memory]");
    lines.push(
      `  used ${humanBytes(snap.mem.usedBytes)} / ${humanBytes(snap.mem.totalBytes)} (${percent(snap.mem.usedPct, 1)})  available ${humanBytes(snap.mem.availableBytes)}`,
    );
  }
  if (snap.disk) {
    lines.push("[Disk]");
    lines.push(`  total R ${humanRate(snap.disk.totalReadBps)}  W ${humanRate(snap.disk.totalWriteBps)}`);
    for (const d of snap.disk.devices) {
      lines.push(`    ${d.name.padEnd(16)}  R ${humanRate(d.readBps).padStart(10)}  W ${humanRate(d.writeBps).padStart(10)}`);
    }
  }
  if (snap.net) {
    lines.push("[Network]");
    lines.push(`  total ↓ ${humanRate(snap.net.totalRxBps)}  ↑ ${humanRate(snap.net.totalTxBps)}`);
    for (const d of snap.net.devices) {
      lines.push(`    ${d.name.padEnd(16)}  ↓ ${humanRate(d.rxBps).padStart(10)}  ↑ ${humanRate(d.txBps).padStart(10)}`);
    }
  }
  if (snap.gpu && snap.gpu.devices.length > 0) {
    lines.push("[GPU]");
    for (const d of snap.gpu.devices) {
      const parts = [
        `vendor=${d.vendor}`,
        `idx=${d.index}`,
        d.name ? `name=${d.name}` : null,
        d.utilPct !== undefined ? `util=${percent(d.utilPct, 1)}` : null,
        d.memUsedBytes !== undefined && d.memTotalBytes !== undefined
          ? `mem=${humanBytes(d.memUsedBytes)}/${humanBytes(d.memTotalBytes)}`
          : null,
        d.tempC !== undefined ? `temp=${d.tempC.toFixed(1)}°C` : null,
        d.powerW !== undefined ? `power=${d.powerW.toFixed(1)}W` : null,
      ].filter(Boolean);
      lines.push(`    ${parts.join("  ")}`);
    }
  }
  const errKeys = Object.keys(snap.errors);
  if (errKeys.length > 0) {
    lines.push("[Errors]");
    for (const k of errKeys) lines.push(`  ${k}: ${snap.errors[k as MetricKey]}`);
  }
  if (diagnostics.length > 0) {
    lines.push("[Diagnostics]");
    for (const d of diagnostics) lines.push(`  ${d}`);
  }
  return lines.join("\n");
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|<>]/g, "\\$&");
}
