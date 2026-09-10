import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { MRPArchive } from "../../src/mrp/archive.ts";

const dirArg = process.argv[2] ?? process.env.MRP_GAME_DIR;
if (!dirArg) { console.error("错误：请传入游戏目录参数或设置 MRP_GAME_DIR 环境变量。"); process.exit(1); }
const root = resolve(dirArg);
const output = process.argv[3] ?? "docs/compatibility/collection-100.json";
const categories = ["大屏动作格斗", "大屏棋牌休闲", "大屏策略角色", "大屏运动赛车", "大屏飞行射击"];
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) :
    e.isFile() && /\.mrp$/i.test(e.name) ? [join(dir, e.name)] : []);
}
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const all = walk(root).sort();
const candidates = all.filter(p => categories.some(c => relative(root, p).startsWith(`240×320游戏大全/${c}/`)) || p.includes("变形金刚"));
const excluded: { path: string; reason: string }[] = [];
const unique = new Map<string, { path: string; sha256: string; category: string }>();
for (const p of candidates) {
  const path = relative(root, p);
  // Scope is individual offline games; classify launchers/resources before executing anything.
  if (!p.includes("变形金刚") && /网游|联网|[Oo][Nn][Ll][Ii][Nn][Ee]|OL|游戏包|游戏大礼包|款.*游戏|FLASH|冒泡筋斗云/.test(path)) {
    excluded.push({ path, reason: "network game or multi-game launcher (filename classification)" }); continue;
  }
  const bytes = readFileSync(p), sha256 = hash(bytes);
  try {
    const archive = MRPArchive.parse(bytes);
    if (!archive.entries.some(e => e.name === "start.mr")) throw new Error("no start.mr entry");
  } catch (e) { excluded.push({ path, reason: String(e) }); continue; }
  if (unique.has(sha256)) { excluded.push({ path, reason: `duplicate content of ${unique.get(sha256)!.path}` }); continue; }
  unique.set(sha256, { path, sha256, category: categories.find(c => path.includes(`/${c}/`)) ?? "变形金刚" });
}
const eligible = [...unique.values()];
let nextId = 1;
const corrections: { id: number; path: string; reason: string }[] = [];
const selected: { id: number; path: string; sha256: string; category: string }[] = [];
function select(e: typeof eligible[number]): void {
  const id = nextId++;
  if (/记账工具/.test(e.path)) {
    corrections.push({ id, path: e.path, reason: "Non-game utility misfiled in action category; preserved in initial baseline, replaced by next deterministic candidate." });
  } else selected.push({ id, ...e });
}
eligible.filter(e => e.path.includes("变形金刚")).forEach(select);
const groups = categories.map(category => eligible.filter(e => e.category === category && !e.path.includes("变形金刚"))
  .sort((a,b) => hash(a.path).localeCompare(hash(b.path), "en")));
for (let i = 0; selected.length < 100; i++) {
  if (!groups.some(g => g[i])) throw new Error("fewer than 100 distinct eligible games");
  for (const g of groups) if (g[i] && selected.length < 100) select(g[i]);
}
const requiredGames = ["神兽传说3-v1001-240x320.mrp", "干柴烈火美女剑-v1003-240x320.mrp",
  "仙剑尘缘录-星辰劫_1002.mrp", "已破-仙剑尘缘录星辰劫_大屏策略角色.mrp"].map(path => {
  const bytes = readFileSync(join(root, path));
  MRPArchive.parse(bytes);
  return { id: nextId++, path, sha256: hash(bytes), category: "用户指定", required: true };
});
writeFileSync(output, JSON.stringify({ version: 3, corrections, selection: "offline-game-categories-path-sha256-v1", totalCandidates: candidates.length,
  eligibleUnique: eligible.length, selected, requiredGames, excluded }, null, 2) + "\n");
console.log(`Frozen ${selected.length} distinct games from ${eligible.length} eligible contents; ${excluded.length} exclusions documented.`);
