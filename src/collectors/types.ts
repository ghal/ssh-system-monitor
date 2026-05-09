export interface CpuSample {
  busyPct: number;
  load1?: number;
  load5?: number;
  load15?: number;
  cores?: number;
}

export interface MemSample {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPct: number;
}

export interface DiskDevice {
  name: string;
  readBps: number;
  writeBps: number;
}

export interface DiskSample {
  totalReadBps: number;
  totalWriteBps: number;
  devices: DiskDevice[];
}

export interface NetDevice {
  name: string;
  rxBps: number;
  txBps: number;
}

export interface NetSample {
  totalRxBps: number;
  totalTxBps: number;
  devices: NetDevice[];
}

export interface GpuDevice {
  vendor: "nvidia" | "amd" | "intel" | "apple";
  index: number;
  name?: string;
  utilPct?: number;
  memUsedBytes?: number;
  memTotalBytes?: number;
  memPct?: number;
  tempC?: number;
  powerW?: number;
}

export interface GpuSample {
  devices: GpuDevice[];
}

export interface Snapshot {
  ts: number;
  cpu?: CpuSample;
  mem?: MemSample;
  disk?: DiskSample;
  net?: NetSample;
  gpu?: GpuSample;
  errors: Partial<Record<MetricKey, string>>;
}

export type MetricKey = "cpu" | "memory" | "disk" | "network" | "gpu";

export interface CollectorContext {
  intervalMs: number;
  commandTimeoutMs: number;
  log: (msg: string) => void;
  diskFilter: (name: string) => boolean;
  netFilter: (name: string) => boolean;
  gpu: {
    vendors: Array<"auto" | "nvidia" | "amd" | "intel" | "apple">;
    show: Array<"util" | "mem" | "temp" | "power">;
    appleSudoCommand: string;
  };
}
