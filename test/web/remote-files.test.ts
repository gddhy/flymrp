import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFileSystem } from "../../src/mythroad/app-fs.ts";
import {
  PRELOAD_SYSTEM_FILES,
  assetUrlFrom,
  createRemoteFileLoaders,
  encodeAssetPath,
  isBundledGameResource,
  isSafeAssetPath,
  resourceAssetUrl,
} from "../../web/remote-files.ts";

afterEach(() => vi.unstubAllGlobals());

describe("remote file path rules", () => {
  it("accepts handset relative paths and rejects traversal or drive-qualified names", () => {
    expect(isSafeAssetPath("system/gb16.uc2")).toBe(true);
    expect(isSafeAssetPath("gsscsc/1001/scene.bin")).toBe(true);
    expect(isSafeAssetPath("../system/gb16.uc2")).toBe(false);
    expect(isSafeAssetPath("system/./gb16.uc2")).toBe(false);
    expect(isSafeAssetPath("c:/mythroad/system/gb16.uc2")).toBe(false);
    expect(isSafeAssetPath("system\\gb16.uc2")).toBe(false);
    expect(PRELOAD_SYSTEM_FILES).toEqual(["system/gb16.uc2"]);
    expect(isBundledGameResource("game/scene.bin")).toBe(true);
    expect(isBundledGameResource("game/old.sav")).toBe(false);
    expect(encodeAssetPath("gwy/gifs/gg ng.gif")).toBe("gwy/gifs/gg%20ng.gif");
    expect(assetUrlFrom("https://example.com/flymrp/", "system/gb16.uc2")).toBe("https://example.com/flymrp/system/gb16.uc2");
    expect(resourceAssetUrl("https://example.com/flymrp/", "GameA/scene.bin")).toBe("https://example.com/flymrp/mythroad_res/GameA/scene.bin");
  });
});

describe("remote file loaders", () => {
  it("fetches cataloged system and pack resources once, skipping unknown names", () => {
    const requests: string[] = [];
    class XHR {
      status = 0;
      response: ArrayBuffer | null = null;
      open(_method: string, url: string) { requests.push(url); this.status = url.includes("missing") ? 404 : 200; }
      send() { this.response = this.status === 200 ? new Uint8Array([1, 2]).buffer : null; }
    }
    vi.stubGlobal("XMLHttpRequest", XHR);
    const names = new AppFileSystem();
    const loaders = createRemoteFileLoaders({
      base: "https://host/app/",
      system: ["plugins/netpay.mrp"],
      resources: ["GameA/scene.bin"],
      packName: "gamea.mrp",
    }, name => names.normalize(name));
    expect(loaders.loadSystemFile("plugins/other.mrp")).toBeNull();
    expect(loaders.loadResourceFile("gameb/other.bin")).toBeNull();
    expect(loaders.loadResourceFile("gamea/old.sav")).toBeNull();
    expect([...loaders.loadSystemFile("plugins/netpay.mrp")!]).toEqual([1, 2]);
    expect([...loaders.loadResourceFile("gamea/scene.bin")!]).toEqual([1, 2]);
    expect(loaders.loadSystemFile("plugins/netpay.mrp")).toEqual(new Uint8Array([1, 2]));
    expect(requests).toEqual([
      "https://host/app/plugins/netpay.mrp",
      "https://host/app/mythroad_res/GameA/scene.bin",
    ]);
  });

  it("prefers the local overlay URL in development and remembers a miss", () => {
    const requests: string[] = [];
    class XHR {
      status = 0;
      response: ArrayBuffer | null = null;
      open(_method: string, url: string) { requests.push(url); this.status = 404; }
      send() { this.response = null; }
    }
    vi.stubGlobal("XMLHttpRequest", XHR);
    const names = new AppFileSystem();
    const loaders = createRemoteFileLoaders({
      base: "https://host/app/",
      system: ["system/gb12.uc2"],
      resources: ["gamea/scene.bin"],
      packName: "gamea.mrp",
      localSystem: true,
      localResources: true,
    }, name => names.normalize(name));
    expect(loaders.loadSystemFile("system/gb12.uc2")).toBeNull();
    expect(loaders.loadResourceFile("gamea/scene.bin")).toBeNull();
    expect(loaders.loadSystemFile("system/gb12.uc2")).toBeNull();
    expect(requests).toEqual([
      "/__system/file/system/gb12.uc2",
      "https://host/app/system/gb12.uc2",
      "/__resources/file/gamea/scene.bin?game=gamea.mrp",
      "https://host/app/mythroad_res/gamea/scene.bin",
    ]);
  });
});
