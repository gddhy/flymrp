# flymrp

Browser-native Mythroad MRP runtime.

当前：guest inflate 完成；AppFS EFS create/write **REAL_EXECUTED**。`arm_ext_call(0)` / Lua 未恢复。Stage 5-C **NOT COMPLETE**（blocker=`table[32] mr_timerStop`）。见 `docs/autonomous-progress.md`。  
Stage 5-C.10R：生产 watchdog 下 guest inflate 完整完成；输出 SHA-256 与 reference gunzip 一致。当时停在 `table[30]`。见 `docs/stage5c10r-progress.md`。  
Stage 5-C.10Q：guest inflate 在 ARM/Thumb 内完成（1,404,897 insn）。可配置 ARM watchdog 默认 2e6 / 上限 20e6。当时生产停在 `table[30]`。见 `docs/stage5c10q-progress.md`。  
Stage 5-C.10P：实现 `table[9]` `memcmp2`（unsigned char，精确 `*su1-*su2`，early exit）。当时 LIVE gzip magic `1F 8B` equal，生产停在 ARM insn budget。见 `docs/stage5c10p-progress.md`。  
Stage 5-C.10N：`table[1]` / `mr_free` ownership + allocation header **只读取证**。当时**未实现** table[1]。当时生产停在 `table[1]`。见 `docs/stage5c10n-progress.md`。  
Stage 5-C.10M：实现 `table[3]` memcpy2（前向逐 byte，非 memmove）+ `table[10]` strcmp2（-1/0/1）。当时**未实现** `table[1]`。当时生产停在 `table[1]`。见 `docs/stage5c10m-progress.md`。  
Stage 5-C.10L：`table[3]` memcpy2 ABI + directory loop 只读取证，当时**未实现**。当时生产停在 `table[3]`。见 `docs/stage5c10l-progress.md`。  
Stage 5-C.10K：实现 current-pack 只读 file backend（table[40]/[44]/[45]/[41]）。当时生产停在 `table[3]` memcpy。见 `docs/stage5c10k-progress.md`。  
Stage 5-C.10J：current-pack file ABI 只读取证 + 只读 handle 设计。当时**未实现** table[40]/41+。当时生产停在 `table[40]`。见 `docs/stage5c10j-progress.md`。  
Stage 5-C.10I：实现 `table[100]` / `pack_filename` 128-byte data slot。当时生产停在 `table[40]`；LIVE filename 为 `"gssjxz.mrp"`。见 `docs/stage5c10i-progress.md`。  
Stage 5-C.10H：`table[40]` / `mr_open` 只读取证，**未实现**。当时空 filename 来自未写入的 `table[100]`。见 `docs/stage5c10h-progress.md`。  
Stage 5-C.10G：`table[17]` / `sprintf_` 仅 **literal + `%d`**。当时生产停在 `table[40]`。见 `docs/stage5c10g-progress.md`。  
Stage 5-C.10F：`table[17]` / `sprintf_` 只读取证，当时未实现。当时生产停在 `table[17]`。见 `docs/stage5c10f-progress.md`。  
Stage 5-C.10E：`table[33]` `mr_getTime` 接 `runtime.clock >>> 0`；当时停在 `table[17]`。见 `docs/stage5c10e-progress.md`。  
Stage 5-C.10D：`table[33]` / `asm_mr_getTime` 只读取证，**未实现**。当时生产停在 `table[33]`。见 `docs/stage5c10d-progress.md`。  
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
npx tsx tools/real/forensics-40.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-3.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-1.ts test/fixtures/real/app.mrp
```
