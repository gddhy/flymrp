import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MythroadRuntime, NullGraphicsBackend } from "../mythroad/index.ts";
import { RuntimeTrace } from "../mythroad/probe.ts";
import { inspectBytes, type InspectResult } from "./inspect.ts";
import { emptyBlockedReport, renderCompatibilityReport, tracesToConfirmedNatives, type CompatibilityReport } from "./report.ts";
import { runPlayablePath } from "./playable.ts";
import { loaderReadiness } from "./readiness.ts";

const REAL_CANDIDATES = ["start.mr", "app.mrp", "魔塔II.jar", "motta.mrp"];

export type GateOptions = {
  bytes?: Uint8Array;
  path?: string;
  fixtureKind?: InspectResult["fixtureKind"];
  steps?: number;
  entry?: string;
  /**
   * Run the real-app playable path (sound dialog → title → start → map → input).
   * Startup-only `steps` never sets `realAppGreen`.
   */
  playable?: boolean;
};

export function discoverRealBinaries(dir: string): string[] {
  const found: string[] = [];
  for (const n of REAL_CANDIDATES) {
    const p = resolve(dir, n);
    if (existsSync(p)) found.push(p);
  }
  return found;
}

export function runCompatibilityGate(opts: GateOptions = {}): CompatibilityReport {
  const readiness = loaderReadiness();
  let bytes = opts.bytes;
  let path = opts.path ?? null;
  if (!bytes && path && existsSync(path)) bytes = new Uint8Array(readFileSync(path));
  if (!bytes) {
    const r = emptyBlockedReport(["no .mr/.mrp provided", "do not mark synthetic as real"]);
    r.readiness = readiness;
    return r;
  }

  const fixtureKind = opts.fixtureKind ?? (opts.path ? "real" : "synthetic");
  const inspect = inspectBytes(bytes, { fixtureKind });
  const report: CompatibilityReport = {
    ...emptyBlockedReport(),
    status: fixtureKind === "real" ? "INSPECTED" : "SYNTHETIC_ONLY",
    realAppGreen: false,
    identity: { path, sha256: inspect.sha256, size: inspect.size },
    inspect,
    readiness,
    fixtureKind,
    notes: fixtureKind === "real" ? inspect.notes : ["synthetic/inspected; not a real-app green", ...inspect.notes],
  };

  if (inspect.classification === "INVALID" || inspect.classification === "UNKNOWN") {
    report.startup = "fail";
    report.failure = { message: `inspect ${inspect.classification}: ${inspect.format}`, sequence: [] };
    return report;
  }
  if (inspect.classification === "UNSUPPORTED") {
    report.startup = "fail";
    report.failure = { message: `UNSUPPORTED: ${inspect.notes.join("; ")}`, sequence: [] };
    return report;
  }

  if (inspect.format !== "MRPG" && inspect.format !== "MRPF") {
    report.notes.push(`inspect-only format ${inspect.format}; runtime load skipped`);
    report.startup = "not-run";
    return report;
  }

  const entry = opts.entry ?? inspect.entry ?? "start.mr";
  if (opts.playable && fixtureKind === "real") {
    const tr = new RuntimeTrace();
    const rt = new MythroadRuntime({ trace: tr, abiMode: "strict" });
    try {
      rt.loadMrp(bytes);
      const playable = runPlayablePath(rt, { entry });
      report.playable = playable;
      report.startup = playable.soundDialog ? "pass" : "fail";
      report.luaExecution = playable.soundDialog ? "pass" : "fail";
      report.realAppGreen = playable.ok;
      if (playable.ok) {
        report.notes.push("real app.mrp has a verified playable path");
        report.notes.push("audio device output unsupported");
        report.notes.push("generated gb16; not device UC2");
      } else {
        report.failure = { message: playable.failure ?? "playable path incomplete", sequence: [] };
      }
    } catch (e) {
      report.startup = report.startup === "pass" ? "pass" : "fail";
      report.luaExecution = "fail";
      report.realAppGreen = false;
      report.failure = {
        message: e instanceof Error ? e.message : String(e),
        sequence: tr.records.slice(-8).map((r) => r.sequence),
      };
    }
    fillTrace(report, inspect, tr, rt);
    return report;
  }

  if (opts.playable) report.notes.push("playable gate is real-app only; not green");

  const g = new NullGraphicsBackend();
  const tr = new RuntimeTrace();
  const rt = new MythroadRuntime({ graphics: g, trace: tr, abiMode: "strict" });
  try {
    rt.loadMrp(bytes);
    rt.start(entry);
    report.startup = "pass";
    report.luaExecution = "pass";
    const n = opts.steps ?? 8;
    for (let i = 0; i < n; i++) {
      if (!rt.step()) break;
    }
  } catch (e) {
    report.startup = report.startup === "pass" ? "pass" : "fail";
    report.luaExecution = "fail";
    report.failure = {
      message: e instanceof Error ? e.message : String(e),
      sequence: tr.records.slice(-8).map((r) => r.sequence),
    };
  }

  fillTrace(report, inspect, tr, rt);
  report.graphics.commands = g.commands.map((c) => c.op);
  if (fixtureKind !== "real") report.realAppGreen = false;
  return report;
}

function fillTrace(
  report: CompatibilityReport,
  inspect: InspectResult,
  tr: RuntimeTrace,
  rt: MythroadRuntime,
): void {
  report.nativeAbi.confirmed = tracesToConfirmedNatives(tr.records);
  report.nativeAbi.unknown = rt.unknownEvents;
  report.ext.modules = inspect.extModules.map((m) => m.name);
  report.ext.entryCalls = tr.records.filter((r) => r.operation === "ext_call" || r.operation === "ext_load").length;
  report.vfs.accessed = unique(
    tr.records.filter((r) => r.operation.startsWith("vfs_")).map((r) => String((r.arguments as { name?: string })?.name ?? "")),
  ).filter(Boolean);
  report.vfs.missing = report.vfs.accessed.filter((n) => !rt.vfs.exists(n) && n !== "start.mr");
  report.timer.callbacks = tr.records.filter((r) => r.operation === "timer_start").length;
  report.events.observed = tr.records.filter((r) => r.operation === "event").length;
  report.restart = tr.records.some((r) => r.operation === "restart" || r.operation === "run_file") ? "observed" : "not observed";
}

export function gateMarkdown(opts: GateOptions = {}): string {
  return renderCompatibilityReport(runCompatibilityGate(opts));
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
