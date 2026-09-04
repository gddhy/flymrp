# Real binary fixtures

Gate: `npx tsx tools/real/inspect.ts test/fixtures/real/app.mrp` — see `docs/real-binary.md`.

User-supplied unprotected MRP (original at `/Users/zixing/Downloads/app.mrp` was not modified):

| 项 | 值 |
|---|---|
| 路径 | `test/fixtures/real/app.mrp` |
| SHA-256 | `77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263` |
| 大小 | 382778 |
| Magic | MRPG |
| 包内名 | `gssjxz.mrp` |
| 应用 | 蜀山剑侠传（杭州斯凯，appid 315024，ver 1006） |
| FileStart / FileLen / ListStart | 5728 / 382778 / 240 |
| 资源 | 234（`start.mr` 两份） |
| EXT | `mrc_loader.ext` 232B MRPGCMAP；`cfunction.ext` 220596B MRPGCMAP |

`mrc_loader.ext` SHA-256 `d36151ee3c119717305afe4b1f0ba47f0f0154f8ba6f2c5081d6402c8eddd938`（与 rxgj 记录的 SkyEngine 232 字节 loader 相同）。

**real-app green: false。** Stage 5-C.10K：current-pack 只读 file backend 已接 `MRPArchive.data`。生产停在 `UNKNOWN_REQUIRED_SLOT = 3`（memcpy）。见 `docs/stage5c10k-progress.md`。

不要把第二份 `start.mr`（含 `sdk_key.dat` / IMEI）当成要跑的入口；`readFile("start.mr")` 只取第一份。不要改原文件。
