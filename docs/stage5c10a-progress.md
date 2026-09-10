# Stage 5-C.10A：Real MRP Startup Baseline

状态：**COMPLETE**（基线记录）。**未实现 table[130]、table[38]、table[33]。Stage 5-D NOT STARTED。**

主路径是真实 `test/fixtures/real/app.mrp`，不是人造 Lua/EXT fixture。  
生产路径 **没有** 未知 ABI handler，也 **没有** 对本阶段扩大 forensic bypass。

```text
REAL MRP BASELINE:
  deterministic: yes
  first production blocker: table[130]
  first post-130 blocker: table[38]
```

---

## 三种状态（禁止混用）

| 状态 | 含义 | 本基线 |
|---|---|---|
| `REAL_EXECUTED` | 真实 guest 执行且 host handler 返回 | table[0]/[14]/[25]/[125]；Lua `_com` / `GetSysInfo` / `_strCom(601/800/801≠0)` / `string.unpack` |
| `FORENSIC_BYPASSED` | 仅 5-C.8/9 probe 用 `cbRet(0)` 越过 130 | **不是**本 run；**不能**写成 supported |
| `NOT_EXECUTED` | 未执行 | 130 = guest 已 BLX、host **无** handler；38/33 = 生产未到达 |

本 run：

```text
130 = NOT_EXECUTED by host
38  = NOT_EXECUTED in production
33  = NOT_EXECUTED
```

---

## MRP

| 项 | 值 |
|---|---|
| path | `test/fixtures/real/app.mrp` |
| size | 382778 |
| sha256 | `77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263` |
| package | `gssjxz.mrp` |
| appname | 蜀山剑侠传 |
| resource count | 234 |

---

## 真实启动链（LIVE）

```text
app.mrp
  ↓
真实 start.mr          (2592 B, 43 opcodes)
  ↓
_com(3629, 2913)       REAL_EXECUTED
GetSysInfo()           REAL_EXECUTED
_strCom(601)           读 mrc_loader.ext
  ↓
_strCom(800)           arm_ext_load r0=3
  ↓
_strCom(801, …, 1)     arm_ext_call(1) r0=0 → Lua 两返回值
string.unpack("II")    REAL_EXECUTED
_strCom(800, table)    加载 cfunction.ext（guest 表 payload）
  ↓
_strCom(801, …, 6)     arm_ext_call(6) r0=0 → Lua 两返回值
  ↓
_strCom(801, …, 0)     arm_ext_call(0) / mrc_init
  ↓
table[130]             STOP  NOT_EXECUTED by host
```

Lua **没有** `LuaRuntimeError` / `err:XXXX`。chunk 未正常返回，因为 C native 抛 `UnknownAbiError: UNKNOWN_REQUIRED_SLOT = 130`。  
`_strCom(801, extra=0)` **没有**把 r0/output 推进 Lua。

---

## EXT / CPU（STOP 于 code 0）

| 项 | 值 |
|---|---|
| mrc_loader | load r0=**3** |
| cfunction.ext | 220596 B，load r0=**0** |
| P | `0x00200100` |
| helper | `0x01ea5e9d` |
| ER_RW | `0x0020021c` |
| rwLen | 19952 |
| arm_ext_call | 1 → 6 → **0** |
| PC | `0x00010208` |
| CPSR | `0x40000010` |
| R0–R3 | `0`, `7`, `0x270f`, `0x00010208` |
| R9 | `0x0020021c` |
| SP | `0x01e7ffb0` |
| LR | `0x01e9cf63` |
| ARM insnCount（code 0） | 90 |
| Lua insnCount | 71 |

---

## mr_table（生产）

调用序：

```text
25, 0, 125, 25, 0, 14, 130
```

| slot | status | guest | handler |
|---|---|---|---|
| 0 | REAL_EXECUTED | yes | yes |
| 14 | REAL_EXECUTED | yes | yes |
| 25 | REAL_EXECUTED | yes | yes |
| 125 | REAL_EXECUTED | yes | yes |
| 130 | NOT_EXECUTED by host | yes | **no** |
| 38 | NOT_EXECUTED | no | no |
| 33 | NOT_EXECUTED | no | no |

STOP：`UNKNOWN_REQUIRED_SLOT = 130`，owner `gssjxz.mrp`。

---

## 进度表

PASS 只表示**真实 guest 执行通过**。

```text
Stage              Status
--------------------------------
MRP parse           PASS
start.mr            PASS
mrc_loader.ext      PASS
cfunction.ext       PASS
cfunction init      PASS
code6               PASS
code0 entry         PASS
table130            BLOCKED
table38             NOT REACHED
table33             NOT REACHED
```

---

## 重复启动

连续 5 次真实 `app.mrp`：

```text
first unknown slot    130
PC                    0x00010208
P / helper / ER_RW    0x00200100 / 0x01ea5e9d / 0x0020021c
rwLen                 19952
ARM insnCount         90
Lua insnCount         71
Lua native sequence   _com, GetSysInfo, _strCom×3, string.unpack, _strCom×3
table slots           25,0,125,25,0,14,130
```

全部一致 → **deterministic: yes**。

---

## 未做

* 未实现 table[130] / [38] / [33]
* 未 fake platform / timer / getTime / DrawText / network
* 未对 38 / 33 做 `cbRet(0)`
* 本 runner 也不对 130 做 `cbRet`
* **Stage 5-D：NOT STARTED**

后继路径仍以 5-C.8/9 静态 + 既有 130 `cbRet(0)` probe 为准：下一未知是 table[38]。

---

## 代码 / 测试

| | |
|---|---|
| runner | `src/real/startup.ts` → `runRealMrpStartup` / `RealMrpStartupReport` |
| 测试 | `test/real/real-mrp-startup.test.ts`（真实 `app.mrp`） |
| CLI | `npx tsx tools/real/startup-baseline.ts test/fixtures/real/app.mrp` |

```bash
npm test
npx tsc --noEmit
```
