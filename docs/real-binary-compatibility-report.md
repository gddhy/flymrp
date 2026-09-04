# Real Binary Compatibility Report

Status: **INSPECTED**  
real-app green: **false**  
fixtureKind: real

## Binary identity

- path: `test/fixtures/real/app.mrp`（原文件 `/Users/zixing/Downloads/app.mrp` 未改）
- sha256: `77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263`
- size: 382778
- format: MRPG
- 包内名: `gssjxz.mrp`
- 应用: 蜀山剑侠传（杭州斯凯，appid 315024，ver 1006）

## Loader result

- classification: CONFIRMED
- FileStart / FileLen / ListStart: 5728 / 382778 / 240
- start.mr: 有（目录里两份；`readFile` 取第一份 2592 字节 C-loader stub）

## Lua chunks

- 第一份 `start.mr`：43 条指令，child 0 = `_mr_c_load`（要求 `_strCom(800)==3`，再 `801` code 1，`unpack("II")` 首字非 0 才二次 `800`）
- 第二份 `start.mr`：SDK/支付版（`sdk_key.dat` / IMEI）。当前不会被读到。

## EXT modules

- `mrc_loader.ext`：232 字节，MRPGCMAP，SHA-256 `d36151ee3c119717305afe4b1f0ba47f0f0154f8ba6f2c5081d6402c8eddd938`
- `cfunction.ext`：220596 字节，MRPGCMAP

## Startup

fail（`UnknownAbiError: UNKNOWN_REQUIRED_SLOT = 33`）。5-C.10C：table[38] code 0x4c6 已执行；见 `docs/stage5c10c-progress.md`。

## Lua execution

fail — `_strCom(801,"",0)` / `arm_ext_call(0)` 越过 table[38] code 0x4c6 后停在 table[33]

## Native ABI

- confirmed calls: `_com(3629,2913)`，`GetSysInfo`，`_strCom(601/800/801)`，`string.unpack("II")`
- unknown calls: **none**（Lua）
- unknown required slot: **33**（`asm_mr_getTime`；LIVE 到达，host 未实现。table[38] code 0x4c6 与 table[130] case 7 已实现。`table[38] registered` ≠ 完整 `mr_platEx`）

## EXT

- modules: `mrc_loader.ext`, `cfunction.ext`
- `arm_ext_load(mrc_loader, code=0)`：**r0=3**
- `arm_ext_call(1)`：kind=return，r0=0；table[0] 分配 8B guest；table[125] 读 `cfunction.ext` 220596B 进 guest
- `arm_ext_load(cfunction, code=0)`：BLX(1) → table[25] P=`0x00200100` helper=`0x01ea5e9d`；table[0] malloc(19956)；table[14] memset(ER_RW,0,19952)；**ret=0**
- `arm_ext_call(6)`：kind=**return**，r0=0（guest helper `0x01ea5e9d`；未实现 host helper）
- `arm_ext_call(0)`：table[130] case 7 **REAL_EXECUTED**（r0=`0x270f`，ER_RW+0x1c=`0x270d`）→ table[14] → table[38] code 0x4c6 **REAL_EXECUTED**（r0=`MR_SUCCESS`）→ table[33] **STOP**

## VFS

- accessed: `start.mr`, `mrc_loader.ext`, `cfunction.ext`
- missing: none

## Graphics

- commands observed: none

## Timer

- callbacks observed: 0

## Events

- events observed: 0

## Restart

not observed

## Failure

`mrc_loader.ext` 已读入 `cfunction.ext`。cfunction load 完成（含 memset）。`arm_ext_call(6)` guest 返回 0。table[130] case 7 与 table[38] code 0x4c6 已执行。第一个真实失败是 **table[33]** `asm_mr_getTime`。未实现 getTime / 完整 platEx / host code 6 helper。未进入 Stage 5-D。

## Readiness

See `src/real/readiness.ts`. All items PARTIAL or BLOCKED. None READY.
