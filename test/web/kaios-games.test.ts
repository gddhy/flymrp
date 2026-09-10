import { describe, expect, it } from "vitest";
import classics from "../../config/classic-games.json";
import kaios from "../../config/kaios-games.json";

describe("KaiOS library manifest", () => {
  it("keeps exactly five classic games that already exist in the web collection", () => {
    expect(kaios.games).toHaveLength(5);
    expect(new Set(kaios.games.map(game => game.path)).size).toBe(5);
    const byPath = new Map(classics.games.map(game => [game.path, game]));
    for (const game of kaios.games) {
      expect(byPath.get(game.path)).toEqual(game);
      expect(game.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(kaios.games.map(game => game.title)).toEqual(["俄罗斯方块", "扫雷", "推箱子", "经典泡泡龙", "黄金矿工"]);
  });
});
