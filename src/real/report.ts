import type { InspectResult } from "./inspect.ts";
import type { ReadinessItem } from "./readiness.ts";
import type { UnknownAbiEvent } from "../mythroad/probe.ts";
import type { TraceRecord } from "../mythroad/probe.ts";
import type { PlayablePathResult } from "./playable.ts";

export type CompatibilityReport = {
  status: "REAL_BINARY_BLOCKED" | "SYNTHETIC_ONLY" | "INSPECTED";
  /** True only after the real-app playable path (title → gameplay + input). */
  realAppGreen: boolean;
  playable: PlayablePathResult | null;
  identity: {
    path: string | null;
    sha256: string | null;
    size: number;
  };
  inspect: InspectResult | null;
  readiness: ReadinessItem[];
  startup: "pass" | "fail" | "not-run";
  luaExecution: "pass" | "fail" | "not-run";
  nativeAbi: { confirmed: string[]; unknown: UnknownAbiEvent[] };
  ext: { modules: string[]; entryCalls: number; unknownSlots: number[] };
  vfs: { accessed: string[]; missing: string[] };
  graphics: { commands: string[] };
  timer: { callbacks: number };
  events: { observed: number };
  restart: "observed" | "not observed";
  failure: { message: string; sequence: number[] } | null;
  fixtureKind: "none" | "synthetic" | "real";
  notes: string[];
};

export function emptyBlockedReport(notes: string[] = []): CompatibilityReport {
  return {
    status: "REAL_BINARY_BLOCKED",
    realAppGreen: false,
    playable: null,
    identity: { path: null, sha256: null, size: 0 },
    inspect: null,
    readiness: [],
    startup: "not-run",
    luaExecution: "not-run",
    nativeAbi: { confirmed: [], unknown: [] },
    ext: { modules: [], entryCalls: 0, unknownSlots: [] },
    vfs: { accessed: [], missing: [] },
    graphics: { commands: [] },
    timer: { callbacks: 0 },
    events: { observed: 0 },
    restart: "not observed",
    failure: null,
    fixtureKind: "none",
    notes: ["REAL_BINARY_BLOCKED", ...notes],
  };
}

export function renderCompatibilityReport(r: CompatibilityReport): string {
  const lines = [
    "# Real Binary Compatibility Report",
    "",
    `Status: **${r.status}**`,
    `real-app green: **${r.realAppGreen}**`,
    `fixtureKind: ${r.fixtureKind}`,
    "",
    r.playable
      ? [
          "## Playable gate",
          "",
          `- sound dialog: ${r.playable.soundDialog}`,
          `- title screen: ${r.playable.titleScreen}`,
          `- start game: ${r.playable.startGame}`,
          `- gameplay frame: ${r.playable.gameplayFrame}`,
          `- gameplay input: ${r.playable.gameplayInput}`,
          `- unknownRequiredSlot: ${r.playable.unknownRequiredSlot ?? "null"}`,
          `- input: ${r.playable.inputSequence.join(" → ") || "(none)"}`,
          "",
        ].join("\n")
      : "",
    "## Binary identity",
    "",
    `- path: ${r.identity.path ?? "(none)"}`,
    `- sha256: ${r.identity.sha256 ?? "(none)"}`,
    `- size: ${r.identity.size}`,
    "",
    "## Format / loader",
    "",
    r.inspect
      ? [
          `- classification: ${r.inspect.classification}`,
          `- format: ${r.inspect.format}`,
          `- magic: ${r.inspect.magic}`,
          `- entry: ${r.inspect.entry ?? "(none)"}`,
          `- FileStart: ${r.inspect.fileStart}`,
          `- FileLen: ${r.inspect.fileLen}`,
          `- resources: ${r.inspect.resources.length}`,
          `- Lua chunks: ${r.inspect.luaChunks.map((c) => c.name).join(", ") || "(none)"}`,
          `- EXT modules: ${r.inspect.extModules.map((e) => `${e.name}:${e.kind}`).join(", ") || "(none)"}`,
        ].join("\n")
      : "- (no bytes)",
    "",
    "## Startup",
    "",
    r.startup,
    "",
    "## Lua execution",
    "",
    r.luaExecution,
    "",
    "## Native ABI",
    "",
    `- confirmed calls: ${r.nativeAbi.confirmed.join(", ") || "(none)"}`,
    `- unknown calls: ${r.nativeAbi.unknown.length}`,
    ...r.nativeAbi.unknown.map((u) => `  - ${u.family} ${u.code} caller=${u.caller}`),
    "",
    "## EXT",
    "",
    `- modules: ${r.ext.modules.join(", ") || "(none)"}`,
    `- entry calls: ${r.ext.entryCalls}`,
    `- unknown slots: ${r.ext.unknownSlots.join(", ") || "(none)"}`,
    "",
    "## VFS",
    "",
    `- accessed: ${r.vfs.accessed.join(", ") || "(none)"}`,
    `- missing: ${r.vfs.missing.join(", ") || "(none)"}`,
    "",
    "## Graphics",
    "",
    `- commands: ${r.graphics.commands.join(", ") || "(none)"}`,
    "",
    "## Timer",
    "",
    `- callbacks: ${r.timer.callbacks}`,
    "",
    "## Events",
    "",
    `- observed: ${r.events.observed}`,
    "",
    "## Restart",
    "",
    r.restart,
    "",
    "## Failure",
    "",
    r.failure ? `${r.failure.message} @ seq ${r.failure.sequence.join(",")}` : "(none)",
    "",
    "## Readiness",
    "",
    ...r.readiness.map((i) => `- ${i.item}: **${i.status}** — ${i.reason}`),
    "",
    "## Notes",
    "",
    ...r.notes.map((n) => `- ${n}`),
    "",
  ];
  return lines.join("\n");
}

export function tracesToConfirmedNatives(records: TraceRecord[]): string[] {
  const names = new Set<string>();
  for (const rec of records) {
    if (rec.operation === "native" || rec.operation === "lua_global") {
      const args = rec.arguments as { name?: string } | null;
      if (args && typeof args === "object" && args.name) names.add(args.name);
    }
  }
  return [...names];
}
