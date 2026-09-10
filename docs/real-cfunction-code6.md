# Real cfunction.ext initialization (Stage 5-C.5)

Stage 5-C.5 implements CONFIRMED `table[14]` memset2. Guest `arm_ext_call(6)` now returns 0.

**Host code 6 helper is not implemented. table[130] is not implemented. Stage 5-D NOT STARTED.**

See `docs/stage5c5-progress.md` for the current first fault.

Diagnostic: `npx tsx tools/real/forensics-code6.ts test/fixtures/real/app.mrp`  
Isolated probe: `npx tsx tools/real/probe-c4.ts test/fixtures/real/app.mrp`

---

## Binary

| field | value |
|---|---|
| pack | `test/fixtures/real/app.mrp` |
| pack SHA-256 | `77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263` |
| cfunction.ext size | 220596 |
| cfunction.ext SHA-256 | `94b8b47f15a91e6900488d8c84cecfeffe19aa9f3a76adb98ef55983d484a926` |
| kind | MRPGCMAP |
| mapped dest | `0x01e80000` |
| `mr_c_function_load` | dest+8 = `0x01e80008` |

Original `/Users/zixing/Downloads/app.mrp` was not modified.

---

## BLX(1) `0xFA00977C`

ARM ARM A8.8.26 encoding A2, ARM state, little-endian bytes `7c 97 00 fa`.

```text
1111 101 H imm24
H = bit24 = 0
imm32 = SignExtend(imm24:H:0) = 0x00977c << 2 = 0x25df0
target = Align(PC,4) + imm32
       = 0x01e80014 + 8 + 0x25df0 = 0x01ea5e0c
from ARM:
  LR = inst+4 = 0x01e80018   (no Thumb bit)
  CPSR.T ← 1
return: BX/LDM to LR runs the ARM epilogue at 0x01e80018
```

C-3 decoder bug: `(word & 0xfe000000) === 0xfa000000` is signed-false in JS, so the insn was UNDEF / NV-skip. Fixed in `src/hot/decode-arm.ts` (`word >>> 25 === 0x7d`).

`0x01ea5e0c` is the Thumb **init body**. It is **not** the helper.

---

## Call site

```text
start.mr  (first copy; C-loader stub)
  _mr_c_load()
    _strCom(601, "mrc_loader.ext")
    _strCom(800, loader, 0)           → r0=3
    _strCom(801, "", 1)               → table[0]/[125] reads cfunction.ext
    _strCom(800, {ptr,len}, 0)        → cfunction load
         ARM 0x01e80008
           BLX(1) → Thumb 0x01ea5e0c  LR=0x01e80018
           table[25] _mr_c_function_new(0x01ea5e9d, 20)
           table[0]  mr_malloc(19956)
           table[14] memset(0x0020021c, 0, 19952)
         STOP  UNKNOWN_REQUIRED_SLOT = 14
  _strCom(801, {1, sysinfo.vmver}, 6)  // not reached
```

---

## Isolated load (MrTableBridge malloc, no unknown-slot trap)

`kind=return` `ret=0` `insnCount=59`

| site | value |
|---|---|
| dest+0 | `0x00010000` |
| dest+4 / P | `0x00200100` |
| dest+0x14 | `0xfa00977c` |
| helper | `0x01ea5e9d` |
| ER_RW | `0x0020021c` |
| rwLen | 19952 |
| R9 | `0` |
| table[14] handler | none → `MR_IGNORE` |

---

## First fault (strict `MythroadRuntime`)

```text
site          mr_c_function_load.table
kind          UNKNOWN_REQUIRED_SLOT
PC            0x00010038   mode=table   (slot 14)
LR            0x01ea5e77
R0            0x0020021c
R1            0
R2            19952
R9            0
dest+4 / P    0x00200100
ER_RW         0x0020021c  len=19952
helper        0x01ea5e9d
owner wrap    P=0x00200100 helper=0x01ea5e9d
memory        table[14] memset(dest=ER_RW, c=0, n=19952)
              identity CONFIRMED mythroad.c, not implemented
code 6        not reached
```

`800` catch then `setExt(null)`. `rt.ext === null`.

---

## CONFIRMED

- `0xFA00977C` is ARM BLX(1) H=0; from ARM, T←1, LR=inst+4, target=Align(PC,4)+SignExtend(imm24:H:0)
- Isolated CPU fixture + Unicorn differential
- cfunction load takes BLX to Thumb `0x01ea5e0c` and calls table[25]
- P / helper come from real guest → table[25] `_mr_c_function_new`
- table[0] malloc(19956); table[14] is memset(ER_RW,0,19952)
- Host `arm_ext_call` ABI for code 6 is unchanged (r0=P r1=6 r9=ER_RW PC=helper)
- Strict first fault after the BLX fix: `UNKNOWN_REQUIRED_SLOT = 14`
- R9 stays 0 on the load path

## INFERRED

- `docs/反汇编研究.c`: helper case 6 stores `input_len` at `R9+0x20` — not compiled Mythroad C; **not implemented**

## UNKNOWN

- Guest-visible effect of actually running memset / later slots
- Whether helper `0x01ea5e9d` implements case 6 as that R9+0x20 store
- ER_RW 19952-byte Image$$ layout

Do not invent a code-6 helper, dummy P, or R9. Do not start Stage 5-D.
