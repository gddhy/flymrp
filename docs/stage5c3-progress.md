# Stage 5-C.3：Real cfunction.ext Code-6 ABI Forensics

状态：**COMPLETE**。**Stage 5-D NOT STARTED。**

未实现 code 6。未设置 dummy P/helper/owner/R9。未改 `src/hot`、`src/abi`。默认 runtime / trace 行为不变。

报告（C-3 当时）：`docs/real-cfunction-code6.md` 已由 5-C.4 更新。  
后续：`docs/stage5c4-progress.md`（BLX 已修；停点改为 table[14]）。

```text
C-3 first fault        arm_ext_call.host_route  ABI  missing_P_or_helper
C-3 cause              decodeArm skipped 0xFA00977C (BLX(1) as UNDEF/NV)
```
