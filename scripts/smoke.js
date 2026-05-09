// Quick smoke harness — runs each collector once outside vscode runtime.
// Note: disk/net deltas need a baseline, so each collector is sampled twice.

const { createCpuCollector } = require("../out/collectors/cpu");
const { createMemCollector } = require("../out/collectors/mem");
const { createDiskCollector } = require("../out/collectors/disk");
const { createNetCollector } = require("../out/collectors/net");
const { createGpuCollector } = require("../out/collectors/gpu");

const ctx = {
  intervalMs: 1000,
  commandTimeoutMs: 3000,
  log: (m) => console.error("[log]", m),
  diskFilter: (n) => !/^(loop|ram|sr|fd|dm-)/.test(n),
  netFilter: (n) => !/^(lo|docker|veth|br-|cni|utun|awdl|llw|anpi|ap1|bridge|gif|stf)/.test(n),
  gpu: { vendors: ["auto"], show: ["util", "mem"], appleSudoCommand: "" },
};

async function trySample(name, fn) {
  try {
    const r = await fn();
    console.log(`[${name}]`, JSON.stringify(r, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
  } catch (err) {
    console.error(`[${name}] error:`, err.message);
  }
}

(async () => {
  const cpu = createCpuCollector();
  const mem = createMemCollector();
  const disk = createDiskCollector();
  const net = createNetCollector();
  const gpu = createGpuCollector();

  console.log("== first tick (establish baseline) ==");
  await trySample("cpu", () => cpu.sample(ctx));
  await trySample("mem", () => mem.sample(ctx));
  await trySample("disk", () => disk.sample(ctx));
  await trySample("net", () => net.sample(ctx));
  await trySample("gpu", () => gpu.sample(ctx));

  await new Promise((r) => setTimeout(r, 1500));

  console.log("\n== second tick (with deltas) ==");
  await trySample("cpu", () => cpu.sample(ctx));
  await trySample("mem", () => mem.sample(ctx));
  await trySample("disk", () => disk.sample(ctx));
  await trySample("net", () => net.sample(ctx));
  await trySample("gpu", () => gpu.sample(ctx));
})();
