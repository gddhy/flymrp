# table[130] / asm_mr_TestCom（Stage 5-C.6）

Forensics only. **table[130] is not implemented. Stage 5-D NOT STARTED.**

详见 `docs/stage5c6-progress.md`。

```bash
npx tsx tools/real/forensics-130.ts test/fixtures/real/app.mrp
```

## 现场

```text
helper 0x01ea5e9c
  BL 0x01ea5ece → 0x01e9ceec
    movs r1, #7
    adds r2, r5, #0          ; r5 = literal 0x270f
    movs r0, #0
    blx  r3                  ; table[130]
      PC=0x00010208  R0=0  R1=7  R2=0x270f  R9=ER_RW
      STOP  UNKNOWN_REQUIRED_SLOT = 130
```

源码：`asm_mr_TestCom` = `_mr_TestCom(L, input0, input1)`。rxgj host：`_mr_TestCom(NULL, r1, r2)`。

本次 `input0=7` 在 `#ifdef MR_PLAT_DRAWTEXT` 下是 `return input1`。无嵌套 mr_table。TestCom 本身不写 ER_RW。

不要猜 7 / 9999 的业务语义。不要实现 TestCom。

返回值对 `mrc_init` 直达 CFG **不是**必要条件。见 `docs/stage5c7-progress.md`。
