# Stage 5-C.7：table[130] 返回值是否挡住 `mrc_init`

状态：**COMPLETE**（只取证）。**未实现 table[130]。Stage 5-D NOT STARTED。**

问题：`_mr_TestCom(NULL, 7, 0x270f)` 的返回值，是不是启动后续 `mrc_init` 的必要条件。

---

## 返回后 CFG（本 pack Thumb）

```text
0x01e9cf60  blx r3              ; table[130]
0x01e9cf62  cmp r0, r5          ; r5 = 0x270f
0x01e9cf64  bne 0x01e9cf6a      ; 不等 → 不写
0x01e9cf66  subs r0, #2         ; 0x270f-2 = 0x270d
0x01e9cf68  str r0, [r4, #0x18] ; r4 = ER_RW+4 → ER_RW+0x1c
0x01e9cf6a  pop {r4, r5, r7, pc}
            ; LR = 0x01ea5ed3 → helper 0x01ea5ed2
```

`pop` **不恢复 R0**。两条路径的 **PC 后继相同**。

```text
helper 0x01ea5ed2
  BL  0x01ea7f68
  adds r4, r0
  BL  0x01ea9254
  … 若干 STR …
  B   0x01ea5f3c
  mov r9, r7
  adds r0, r4
  add sp, #0x1c
  pop {r4-r7, pc}          ; helper 返回 host
```

`0x01ea7f68` 的第一个 callee `0x01eab1ac` 在 `push` 之后立刻 `ldr r0, [pc, #…]`，**覆盖**传入的 R0。TestCom 的返回值 **不会**作为下一个 BL 的参数。

---

## 路径 A / B（静态，未执行 handler）

| | A：返回 0 | B：返回 0x270f |
|---|---|---|
| `cmp r0, r5` | NE | EQ |
| 写 `ER_RW+0x1c` | **否**（保持 memset 的 0） | **是**（`0x270d`） |
| 回到 helper | `0x01ea5ed2` | `0x01ea5ed2` |
| 下一指令 | `BL 0x01ea7f68` | 同左 |
| helper 是否因返回值分叉 | **否** | **否** |

两条路径进入 **同一个** 后续初始化阶段（`0x01ea7f68` → `0x01ea9254` → epilogue）。

`0x01ea7f68` / `0x01e92d2c` 内部还有其它 `BLX`（可能再打 mr_table）。那是 **下一处 ABI**，与 TestCom 返回值 **无数据依赖**。本阶段不追、不实现。

---

## `ER_RW+0x1c` 写 / 读

### write

```text
仅一处（本 pack）：
  0x01e9cf68  STR 0x270d → [r4, #0x18] = ER_RW+0x1c
  条件：table[130] 返回 == 0x270f
```

### read（`0x270d` 字面量 xref）

`cfunction.ext` 里 `0x270d` 只出现 3 次，且 **同一种** 用法：

```text
rX = r9 + 4
rY = [rX, #0x18]          ; ER_RW+0x1c
cmp rY, #0x270d
bne skip
  … 之后 BLX 某函数指针（栈上对象 / 表）
```

| 比较点 | 字面量 | r9 偏移 |
|---|---|---|
| `0x01ea6e8e` | `0x01ea6f80` | +4 |
| `0x01ea71d2` | `0x01ea73a0` | +4 |
| `0x01ea7478` | `0x01ea7544` | +4 |

这三处落在以 `0x01ea6e2c` 为入口的大函数里。对该入口的 `BL` 来自 `0x01ea7340` / `0x01ea7508`（函数内部），**不是** helper code 0 在 TestCom 之后的直达边。

`0x01ea7f68` 可能 `BL 0x01ea6dd4`（短函数，`0x01ea6dd4`–`0x01ea6e10`），**不含** 上述比较。

### consumer

后续若执行到这些比较：

* `ER_RW+0x1c == 0x270d`：走 `BLX` 指针路径
* 否则：走另一段（半字坐标 / 其它计算）

**本阶段 `arm_ext_call(0)` 的 helper code-0 直达 CFG 读不到 `ER_RW+0x1c`。**  
这些读点会在 **其它 helper code / 其它调用** 出现。不要把函数名猜成 DrawText / socket。

---

## `0x270f` / `0x270d` 引用

| 值 | VA | 角色 |
|---|---|---|
| `0x270f` | `0x01e9cf78` | **仅此一处**。TestCom 调用的 R5/R2 字面量 |
| `0x270d` | `0x01ea6f80` `0x01ea73a0` `0x01ea7544` | 三处 `cmp` 立即数（上表） |

没有其它 `0x270f` / `0x270d` 字面量。不要猜端口 / 超时 / 版本号。

---

## helper 返回之后

```text
arm_ext_call(0)
  → helper 返回 r0 = 0x01ea7f68 的返回值（与 TestCom r0 无关）
  → _strCom(801, "", 0) 把 output + r0 压 Lua
```

样例 `unused/start.mr.lua`：`801/0` 之后可能再 `801` event `5001`。真实第一份 `start.mr` 是 C-loader stub；**801/0 尚未跑完**，stub 在 801/0 之后做什么 **本阶段未动态看到**。

`801/0` 的 Lua 后继 **不读** guest `ER_RW+0x1c`（host `_strCom` 只看 `arm_ext_call` 的 r0/output）。

---

## Q1–Q5

| 问题 | 结论 | 分级 |
|---|---|---|
| **Q1** 返回 0 是否足以继续 **这段** `mrc_init`（过 TestCom、进 `0x01ea7f68`）？ | **是。** 后继 PC 与 B 相同；R0 被下一 BL 丢掉 | **CONFIRMED** |
| **Q2** 返回 9999 是否必要？ | **对这段 helper 直达 CFG：否。** 只决定是否写 `0x270d` | **CONFIRMED**（本 call） |
| **Q3** `ER_RW+0x1c` 的 `0x270d` 是否被后续读取？ | **会读，但不在本次 helper code-0 直达路上。** 三处 `cmp` 在 `0x01ea6e2c` 大函数 | **CONFIRMED**（存在读点）；是否在 **本次** `arm_ext_call(0)` 内执行 = **UNKNOWN** |
| **Q4** table[130] 是否只是 capability/probe？ | 写标志 + 日后比较再 `BLX`，**像** probe。EQ 路径不是空操作 | **INFERRED** |
| **Q5** 现在有没有足够证据实现 table[130]？ | **没有。** 本 call 的 init 不依赖返回值；实现等于在 0 与 9999 里选边，影响未跑到的 `BLX` 路径 | **CONFIRMED**（不实现） |

---

## CONFIRMED / INFERRED / UNKNOWN

### CONFIRMED

- 返回后只有 `cmp`/`bne`/`str`/`pop`；两条路径会合于 `0x01ea5ed2`
- helper 下一阶段是 `BL 0x01ea7f68`，其 callee `0x01eab1ac` 覆盖 R0
- 写 `ER_RW+0x1c=0x270d` 仅当返回 `0x270f`
- `0x270f` 一字面量；`0x270d` 三字面量，全是 `r9+4+0x18` 比较
- 这三处 **不是** helper code-0 在 TestCom 之后的直达后继
- 未实现 table[130]；first fault 仍是 130

### INFERRED

- `0x270d` 是给后续路径用的能力标志（比较后选 `BLX`）
- 返回 0 时，后续若跑到那三处，会走 `bne` 侧
- 样例 ARM / `反汇编研究.c` 是同一模式、不同偏移

### UNKNOWN

- 三处 consumer 在哪些 helper code（event / 其它）上执行
- EQ 侧 `BLX` 的目标 slot / 函数身份（**不猜** DrawText）
- `0x01ea7f68` 是否在返回前再打未知 table（与 TestCom 返回值无关）
- 真实 `start.mr` 在 801/0 **成功返回之后** 的下一条 Lua
- 7 / 9999 / 0x270d 的业务名

---

## 未做

- 不实现 table[130] / 不选 0 或 9999 fallback
- 不改 `_plat*` / 其它 slot / Canvas / Network / code 6 helper
- 不进入 Stage 5-D
- 不装假 handler 跑 A/B（只静态 CFG）

```bash
npm test
npx tsc --noEmit
npx tsx tools/real/forensics-c7.ts test/fixtures/real/app.mrp
```

只读取证：`src/real/testcom130dep.ts`，`test/real/testcom-130-dep.test.ts`。
