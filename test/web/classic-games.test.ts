import { describe, expect, it } from "vitest";
import classics from "../../config/classic-games.json";

describe("classic library manifest", () => {
  it("contains exactly 100 explicit paths, including all requested editions", () => {
    const paths = classics.games.map(game => game.path);
    expect(paths).toHaveLength(100);
    expect(new Set(paths).size).toBe(100);
    expect(paths).toEqual(expect.arrayContaining([
      "神兽传说3-v1001-240x320.mrp", "干柴烈火美女剑-v1003-240x320.mrp",
      "仙剑尘缘录-星辰劫_1002.mrp", "已破-仙剑尘缘录星辰劫_大屏策略角色.mrp",
      "240×320游戏大全/大屏策略角色/_已破-美游神剑破千军_大屏策略角色.mrp",
      "240×320游戏大全/大屏动作格斗/免费-积创变形金刚_大屏动作格斗.mrp",
    ]));
    for (const game of classics.games) {
      expect(game.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(game.title.length).toBeGreaterThan(0);
      expect(game.category.length).toBeGreaterThan(0);
    }
  });
});
