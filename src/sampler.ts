import * as vscode from "vscode";
import type { Config } from "./config";
import { compileFilter } from "./config";
import { createCpuCollector } from "./collectors/cpu";
import { createMemCollector } from "./collectors/mem";
import { createDiskCollector } from "./collectors/disk";
import { createNetCollector } from "./collectors/net";
import { createGpuCollector } from "./collectors/gpu";
import type { CollectorContext, MetricKey, Snapshot } from "./collectors/types";

const MAX_FAILURES = 3;

export class Sampler implements vscode.Disposable {
  private timer: NodeJS.Timeout | null = null;
  private cpu = createCpuCollector();
  private mem = createMemCollector();
  private disk = createDiskCollector();
  private net = createNetCollector();
  private gpu = createGpuCollector();
  private failures: Record<MetricKey, number> = {
    cpu: 0,
    memory: 0,
    disk: 0,
    network: 0,
    gpu: 0,
  };
  private disabled: Record<MetricKey, boolean> = {
    cpu: false,
    memory: false,
    disk: false,
    network: false,
    gpu: false,
  };
  private latest: Snapshot | null = null;
  private listeners = new Set<(s: Snapshot) => void>();
  private running = false;

  constructor(
    private cfg: Config,
    private log: (msg: string) => void,
  ) {}

  start(): void {
    this.tick().catch((err) => this.log(`tick error: ${err}`));
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log(`tick error: ${err}`));
    }, this.cfg.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  updateConfig(cfg: Config): void {
    const oldInterval = this.cfg.intervalMs;
    const oldVendors = this.cfg.metrics.gpu.vendors.join(",");
    this.cfg = cfg;
    if (cfg.metrics.gpu.vendors.join(",") !== oldVendors) {
      this.gpu.setVendors(cfg.metrics.gpu.vendors);
    }
    // Reset failure counters so users see metrics retry after a config change.
    for (const k of Object.keys(this.failures) as MetricKey[]) {
      this.failures[k] = 0;
      this.disabled[k] = false;
    }
    if (cfg.intervalMs !== oldInterval && this.timer) {
      this.stop();
      this.start();
    }
  }

  onSnapshot(fn: (s: Snapshot) => void): vscode.Disposable {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }

  getLatest(): Snapshot | null {
    return this.latest;
  }

  diagnostics(): string[] {
    const out: string[] = [];
    for (const [k, count] of Object.entries(this.failures)) {
      if (count > 0) out.push(`${k}: ${count} consecutive failures`);
    }
    for (const [k, off] of Object.entries(this.disabled)) {
      if (off) out.push(`${k}: muted (>= ${MAX_FAILURES} failures)`);
    }
    out.push(...this.gpu.diagnostics());
    return out;
  }

  async tickNow(): Promise<Snapshot | null> {
    await this.tick();
    return this.latest;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private buildContext(): CollectorContext {
    return {
      intervalMs: this.cfg.intervalMs,
      commandTimeoutMs: this.cfg.commandTimeoutMs,
      log: this.log,
      diskFilter: compileFilter(
        this.cfg.metrics.disk.includePattern,
        this.cfg.metrics.disk.excludePattern,
      ),
      netFilter: compileFilter(
        this.cfg.metrics.network.includePattern,
        this.cfg.metrics.network.excludePattern,
      ),
      gpu: {
        vendors: this.cfg.metrics.gpu.vendors,
        show: this.cfg.metrics.gpu.show,
        appleSudoCommand: this.cfg.metrics.gpu.apple.sudoCommand,
      },
    };
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ctx = this.buildContext();
      const tasks: Array<Promise<void>> = [];
      const snap: Snapshot = { ts: Date.now(), errors: {} };

      const run = async <T,>(
        key: MetricKey,
        enabled: boolean,
        runner: () => Promise<T>,
        assign: (v: T) => void,
      ) => {
        if (!enabled || this.disabled[key]) return;
        try {
          const v = await runner();
          assign(v);
          this.failures[key] = 0;
        } catch (err) {
          this.failures[key]++;
          const msg = err instanceof Error ? err.message : String(err);
          snap.errors[key] = msg;
          if (this.failures[key] >= MAX_FAILURES) {
            this.disabled[key] = true;
            this.log(`${key}: muted after ${MAX_FAILURES} failures: ${msg}`);
          }
        }
      };

      tasks.push(
        run("cpu", this.cfg.metrics.cpu.enabled, () => this.cpu.sample(ctx), (v) => {
          snap.cpu = v;
        }),
      );
      tasks.push(
        run("memory", this.cfg.metrics.memory.enabled, () => this.mem.sample(ctx), (v) => {
          snap.mem = v;
        }),
      );
      tasks.push(
        run("disk", this.cfg.metrics.disk.enabled, () => this.disk.sample(ctx), (v) => {
          snap.disk = v;
        }),
      );
      tasks.push(
        run("network", this.cfg.metrics.network.enabled, () => this.net.sample(ctx), (v) => {
          snap.net = v;
        }),
      );
      tasks.push(
        run("gpu", this.cfg.metrics.gpu.enabled, () => this.gpu.sample(ctx), (v) => {
          snap.gpu = v;
        }),
      );

      await Promise.all(tasks);
      this.latest = snap;
      for (const fn of this.listeners) {
        try {
          fn(snap);
        } catch (err) {
          this.log(`listener error: ${err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
