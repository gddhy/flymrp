export type ReadinessStatus = "READY" | "PARTIAL" | "BLOCKED";

export type ReadinessItem = {
  item: string;
  status: ReadinessStatus;
  reason: string;
};

/**
 * Synthetic fixture pass ≠ READY. A real MRP on disk is still PARTIAL until
 * startup completes without Exit / unknown ABI. Nothing is READY.
 */
export function loaderReadiness(): ReadinessItem[] {
  return [
    { item: "MRPG / MRPF", status: "PARTIAL", reason: "parser exists; real gssjxz.mrp inspected, not green" },
    { item: "Lua \\033MRP", status: "PARTIAL", reason: "chunk loader exists; real start.mr is a C-loader stub" },
    { item: "nested MRP", status: "PARTIAL", reason: "openNested exists; no real nested pack" },
    { item: "FileStart / FileEnd", status: "PARTIAL", reason: "header fields parsed; real FileLen=382778" },
    { item: "gzip", status: "PARTIAL", reason: "1F 8B + inflate; real stored entries inflate" },
    { item: "EXT MRPGCMAP", status: "PARTIAL", reason: "cfunction load + code 6 guest return 0; guest inflate completes; DrawRect/DrawText/drawBitmap/winCreate/plat(1205) REAL_EXECUTED; production STOP at mr_open(gssjxz\\69) EFS; Stage 5-C NOT COMPLETE" },
    { item: "stripped ARM ELF-like", status: "PARTIAL", reason: "PT_LOAD relocate path; fixtures only" },
    { item: "P / ER_RW", status: "PARTIAL", reason: "real table[25] sets P/helper; memset zeros ER_RW; R9 set at arm_ext_call" },
    { item: "150-slot mr_table", status: "PARTIAL", reason: "slots 0/14/25/125/130(case 7)/38(0x4c6+SWITCHPATH)/33/17/40/44/45/41 + 3/10/1/9/30/37/26/42/49/5/35/61/15/6/18/7/122/123/29/78 wired; plat 1205 PASS; EFS mr_open gssjxz\\69 blocked" },
    { item: "nested EXT owner", status: "PARTIAL", reason: "ModuleOwners in Stage 4; fixtures only" },
    { item: "Lua chunk loading", status: "PARTIAL", reason: "first start.mr; 801/1 and 801/6 return to Lua; 801/0 completes guest inflate then STOP at EFS mr_open; Lua not resumed" },
    { item: "_runFile / restart", status: "PARTIAL", reason: "state machine exists; synthetic only" },
    { item: "real start.mr / .mrp", status: "PARTIAL", reason: "app.mrp present; deterministic STOP at mr_open(\"gssjxz\\\\69\") EFS; inflate POP return + SHA-256 oracle match; plat(1205) TOUCH; arm_ext_call(0)/Lua not resumed; Stage 5-C NOT COMPLETE" },
    { item: "魔塔II.jar / DRM", status: "BLOCKED", reason: "no jar in workspace; DRM not attempted" },
  ];
}

export function anyReady(items = loaderReadiness()): boolean {
  return items.some((i) => i.status === "READY");
}
