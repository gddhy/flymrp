# flymrp

Browser-native Mythroad MRP runtime.

Stage 5-C.10D（当前）：`table[33]` / `asm_mr_getTime` 只读取证，**未实现**。生产仍停在 `table[33]`。见 `docs/stage5c10d-progress.md`。  
Stage 5-C.10C：`table[38]` 仅 `mr_platEx` code `0x4c6`（rxgj FULL `MR_SUCCESS`，无副作用）；真实 app 停在 `table[33]`。见 `docs/stage5c10c-progress.md`。  
Stage 5-C.10B：`table[130]` 仅 case 7（rxgj FULL）；当时停在 `table[38]`。见 `docs/stage5c10b-progress.md`。  
Stage 5-C.10A：真实 `app.mrp` 启动基线（实现 130 前停在 130）。见 `docs/stage5c10a-progress.md`。  
Stage 5-C.9：`table[38]` / `asm_mr_platEx` 只读取证，未实现。见 `docs/stage5c9-progress.md`。  
Stage 5-C.8：`mrc_init` 后继 BLX / `table[38]` platEx 取证，未实现。见 `docs/stage5c8-progress.md`。  
Stage 5-C.7：table[130] 返回值对 `mrc_init` 的依赖取证，未实现。见 `docs/stage5c7-progress.md`。  
Stage 5-C.6：table[130] / `asm_mr_TestCom` 只读取证，未实现。见 `docs/stage5c6-progress.md`。  
Stage 5-C.5：CONFIRMED table[14] memset ABI。见 `docs/stage5c5-progress.md`。  
Stage 5-C.4：恢复真实 cfunction.ext 初始化链。见 `docs/stage5c4-progress.md`。  
Stage 5-C.3：Real cfunction.ext Code-6 ABI Forensics。见 `docs/real-cfunction-code6.md`。  
Stage 5-C.2：Real EXT Loader ABI Wiring。见 `docs/stage5c2-progress.md`。  
Stage 5-C.1：Real Binary Readiness & Compatibility Gate。见 `docs/real-binary.md`。  
Stage 5-C：Mythroad 兼容层。见 `docs/stage5c-progress.md`。  
Stage 5-B：Mythroad Core Runtime。见 `docs/stage5b-progress.md`。  
Stage 5-A：MRP + Lua VM，见 `docs/stage5a-progress.md`。  
Stage 4：EXT ABI，见 `docs/stage4-progress.md`。  
**Stage 5-D：NOT STARTED。**

```bash
npm test
npx tsx bench/run.ts
npx tsx tools/real/inspect.ts test/fixtures/real/app.mrp
npx tsx tools/real/startup-baseline.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-33.ts test/fixtures/real/app.mrp
```
