import * as vscode from "vscode";
import { readConfig } from "./config";
import { Sampler } from "./sampler";
import { StatusBarManager } from "./statusbar";
import { renderDetailReport } from "./detail";

let sampler: Sampler | null = null;
let statusBar: StatusBarManager | null = null;
let output: vscode.OutputChannel | null = null;
let configWatcher: vscode.Disposable | null = null;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("SSH System Monitor");
  context.subscriptions.push(output);
  const log = (msg: string) => output?.appendLine(`[${new Date().toISOString()}] ${msg}`);

  const cfg = readConfig();
  const isRemote = !!vscode.env.remoteName;

  if (!isRemote && !cfg.runOnLocal) {
    log(
      `idle: not connected to a remote (vscode.env.remoteName is undefined). ` +
        `Set sshMonitor.runOnLocal=true to enable here.`,
    );
    registerCommands(context, log);
    return;
  }

  log(
    `activating on ${process.platform}; remoteName=${vscode.env.remoteName ?? "(none)"}; ` +
      `interval=${cfg.intervalMs}ms`,
  );

  if (!cfg.enabled) {
    log("disabled via sshMonitor.enabled=false");
    registerCommands(context, log);
    return;
  }

  start(context, log);
  registerCommands(context, log);
  watchConfig(context, log);
}

export function deactivate(): void {
  configWatcher?.dispose();
  configWatcher = null;
  sampler?.dispose();
  sampler = null;
  statusBar?.dispose();
  statusBar = null;
  output?.dispose();
  output = null;
}

function start(context: vscode.ExtensionContext, log: (msg: string) => void): void {
  const cfg = readConfig();
  statusBar = new StatusBarManager(cfg);
  sampler = new Sampler(cfg, log);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(sampler);
  context.subscriptions.push(
    sampler.onSnapshot((snap) => {
      statusBar?.render(snap);
    }),
  );
  sampler.start();
}

function stop(): void {
  sampler?.dispose();
  sampler = null;
  statusBar?.dispose();
  statusBar = null;
}

function watchConfig(context: vscode.ExtensionContext, log: (msg: string) => void): void {
  configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration("sshMonitor")) return;
    const cfg = readConfig();
    log("config changed; applying");
    const isRemote = !!vscode.env.remoteName;
    const shouldRun = cfg.enabled && (isRemote || cfg.runOnLocal);

    if (!shouldRun) {
      stop();
      return;
    }
    if (!sampler || !statusBar) {
      start(context, log);
      return;
    }
    statusBar.updateConfig(cfg);
    sampler.updateConfig(cfg);
  });
  context.subscriptions.push(configWatcher);
}

function registerCommands(context: vscode.ExtensionContext, log: (msg: string) => void): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sshMonitor.showDetails", () => {
      if (!output) return;
      const snap = sampler?.getLatest() ?? null;
      const diagnostics = sampler?.diagnostics() ?? [];
      output.clear();
      output.appendLine(renderDetailReport(snap, diagnostics));
      output.show(true);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sshMonitor.refreshNow", async () => {
      if (!sampler) {
        vscode.window.showInformationMessage("SSH Monitor is not active in this window.");
        return;
      }
      await sampler.tickNow();
      log("manual refresh complete");
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sshMonitor.toggleEnabled", async () => {
      const c = vscode.workspace.getConfiguration("sshMonitor");
      const cur = c.get<boolean>("enabled", true);
      await c.update("enabled", !cur, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`SSH Monitor: ${!cur ? "enabled" : "disabled"}`);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sshMonitor.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "sshMonitor");
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("sshMonitor.manage", async () => {
      const enabled = vscode.workspace.getConfiguration("sshMonitor").get<boolean>("enabled", true);
      const picks: (vscode.QuickPickItem & { id: string })[] = [
        { id: "details", label: "$(info) Show Details", description: "Open the latest snapshot in the Output panel" },
        { id: "refresh", label: "$(sync) Refresh Now", description: "Force a fresh sample" },
        { id: "settings", label: "$(gear) Open Settings", description: "Edit sshMonitor.* configuration" },
        {
          id: "toggle",
          label: enabled ? "$(circle-slash) Disable" : "$(check) Enable",
          description: enabled ? "Stop sampling" : "Start sampling",
        },
      ];
      const choice = await vscode.window.showQuickPick(picks, {
        placeHolder: "SSH System Monitor",
      });
      if (!choice) return;
      switch (choice.id) {
        case "details":
          await vscode.commands.executeCommand("sshMonitor.showDetails");
          break;
        case "refresh":
          await vscode.commands.executeCommand("sshMonitor.refreshNow");
          break;
        case "settings":
          await vscode.commands.executeCommand("sshMonitor.openSettings");
          break;
        case "toggle":
          await vscode.commands.executeCommand("sshMonitor.toggleEnabled");
          break;
      }
    }),
  );
}
