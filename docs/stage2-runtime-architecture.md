# Stage 2：浏览器 JIT 导向的 MRP Web Runtime 架构

状态：设计冻结候选。本文件不包含实现代码。  
依据：`/Users/zixing/Downloads/rxgj-main` 源码 + 仓库内 `start.mr` 源文本 / e2e 注释。  
标记：`[HOT]` `[COLD]` `[ABI]` `[DEBUG]` `[PLATFORM]`

---

## 0. 设计原则

这是专门跑 Mythroad MRP 的浏览器 runtime，不是通用 ARM 模拟器、不是通用 Lua、不是 POSIX。

三层：

```text
Layer 1  [PLATFORM]   Browser：Canvas / WebAudio / Input / rAF / VFS / Worker 预留
Layer 2  [ABI]        Mythroad Compatibility：150 槽、DSM、堆、owner、图形语义
Layer 3  [HOT]        Guest Execution：ARM/Thumb VM  与  Lua VM（解耦）
```

Lua 与 ARM **不共享 CPU 状态**。它们共享 Layer 2。

热路径禁止：

- 每条指令 `new` 对象
- 每条指令 `Map` lookup
- 每条 LDR/STR 多层虚调用
- `eval` / `new Function`
- 主线程 `while (true)`

冷路径允许 class / interface / Map。

---

## A. Runtime module graph

```text
                    index.html
                         │
                         ▼
                 MRPWebRuntime [COLD]
                         │
         ┌───────────────┼────────────────┐
         ▼               ▼                ▼
   Scheduler[HOT]   Platform[PLATFORM]   Loader[COLD]
         │               │                │
         ▼               │                ▼
   GuestSlice            │          MrpArchive
         │               │
    ┌────┴─────┐         │
    ▼          ▼         │
 ARM VM      Lua VM      │
 [HOT]       [COLD*]     │
    │          │         │
    └────┬─────┘         │
         ▼               │
   MythroadRuntime [ABI] ◄┘
         │
    ┌────┼─────────┬──────────┬─────────┐
    ▼    ▼         ▼          ▼         ▼
  Heap  Bridge   Nested    Graphics   VFS
  [ABI] [HOT†]   [ABI]     [PLATFORM] [COLD]
```

`[COLD*]`：Lua 在 FULL 应用启动和事件转发时是暖路径，但相对 ARM 游戏循环不是第一瓶颈。  
`[HOT†]`：table 调用相对指令是稀有的，但单次成本高（memcpy/画图/文件）。热的是「进入 bridge 的判定」，不是 150 个 handler 本身。

可执行文件边界：

```text
src/hot/          禁止 import DOM / 禁止分配指令对象
src/abi/          150 槽、owner、堆、EXT 加载
src/lua/          bytecode VM（与 ARM 无 import 环）
src/platform/     Canvas / Audio / Input / IDB
src/test/         Unicorn diff，不进 production bundle
src/bench/        浏览器微基准
```

---

## B. TypeScript interfaces（冷路径契约）

下列类型是 **模块边界**，不是热循环里的每条指令。

```ts
// [COLD] 对外 API
interface MRPWebRuntime {
  load(source: ArrayBuffer | File): Promise<void>;
  mountCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void;
  start(): void;
  stop(): void;
  setEntry(extName: string, entry?: string): void; // start.mr | cfunction.ext
}

// [ABI] 与 Unicorn 可对齐的 guest CPU 快照
interface ArmSnapshot {
  r: Uint32Array; // length 16, r13=sp r14=lr r15=pc
  cpsr: number;   // 含 T；N/Z/C/V 也在此，热路径可不每拍打包
}

// [COLD] 模块 owner，禁止合成一个 “current module”
interface ModuleOwners {
  wrapperP: number; wrapperHelper: number;
  primaryP: number; primaryHelper: number;
  activeP: number; activeHelper: number;
  timerP: number; timerHelper: number;
  screenP: number; screenHelper: number;
  currentP: number; currentHelper: number;
}

// [ABI]
interface ExtChunkView {
  magic: number;      // 0x7FD854EB
  init: number;       // +0x04
  helper: number;     // +0x08
  file: number;       // +0x0C
  fileLen: number;    // +0x10
  rw: number;         // +0x14
  rwLen: number;      // +0x18
  p: number;          // +0x1C
  suspend: number;    // +0x34 计数器
}

// [COLD] 可执行映像区间，供 R9 / block cache 分区
interface ExecRegion {
  base: number;
  len: number;
  pAddr: number;
  rwBase: number;
  blockId: Uint32Array; // [(pc-base)>>>2] → pool index，0=miss
}

// [DEBUG] 仅诊断
interface DecodedOpView {
  kind: string;
  cond: number;
  rd: number;
  rn: number;
  rm: number;
  imm: number;
}
```

热路径 **没有** `class Instruction` / `class Operand` / `class Memory`。

---

## C. Hot-path architecture

### 哪些代码是 [HOT]

按预期占用排序（见 M；必须以 bench 校准）：

1. ARM/Thumb 块内循环：dispatch + ALU + 对齐 RAM LDR/STR
2. 块查找：`region.blockId[(pc-base)>>>2]`
3. 条件执行 / 分支
4. table 入口判定（PC 落在 `0x10000..0x10257`）
5. `memcpy`/`memset`/`readFile` 的大块拷贝（次数少、字节多）

### 热循环形状

只允许这种形状（伪代码，不是实现）：

```text
[HOT]
while (running && budget--) {
  pc = r[15] >>> 0
  if (pc 落在 table 带) → [ABI] handleTable; continue
  region = lastRegion 或 线性扫 ExecRegion[]   // N≤64
  id = region.blockId[(pc - region.base) >>> 2]
  if (id === 0) id = decodeBlock(...)            // [COLD] 首次
  executePackedBlock(r, ram32, packed, id)       // 无对象
}
```

`executePackedBlock` 内：

- `r` 是 `Uint32Array`
- `ram32` 是主映射 `Uint32Array`
- `packed` 是该块的 `Uint32Array` 指令流
- `switch (op)` 单态函数，禁止 `handlers[op]()` 作为主 dispatch

### 热路径禁止清单

| 禁止 | 原因 |
|---|---|
| `new Instruction()` | GC |
| `Map.get(pc)` | 隐藏类/哈希 |
| `mem.read32()` 多层 | 调用 + 多态 |
| 每条指令读 `cpsr` 再拆 4 flag | 多余移位 |
| 每条 STR 扫 GOT | 无必要 |
| DOM / AudioContext | 在 [PLATFORM] |

---

## D. Cold-path architecture

| 子系统 | 标记 | 可用工具 |
|---|---|---|
| MRP/EXT 解析、gzip | [COLD] | class、普通对象 |
| 首次 decode block | [COLD] | 临时局部变量，结果写入 packed |
| 未实现 opcode trap | [COLD] | 抛诊断对象 |
| nested 注册 / 退役 | [ABI] | 普通结构体 |
| GOT snapshot/restore | [ABI] | 在已知 API 点 |
| Lua undump / GC | [COLD] | 对象、表（Lua 自己的堆） |
| VFS / IDB | [PLATFORM] | Promise、Map |
| Unicorn diff | [DEBUG] | 任意 |
| 反汇编打印 | [DEBUG] | `DecodedOpView[]` |

冷路径可以 OOP。热路径看到的只有 TypedArray 和整数。

---

## E. ARM/Thumb execution model

### 寄存器 [HOT]

比较（**必须在 Chrome / Safari / Firefox 上跑 `bench/regs_*`，不能用本段当最终赢家**）：

| 方案 | 优点 | 风险 |
|---|---|---|
| A `Uint32Array(16)` | 索引 `r[rd]` 自然；与 ARM rd/rn/rm 一致；无 hidden class 漂移 | 每次访问有 TypedArray 边界检查（常量下标常被消除） |
| B `cpu.r0…r15` | V8 对稳定 hidden class + 整数域可能把值放进机器寄存器 | **rd 是变量时必须 16 路分发**，比 `r[rd]` 更差 |
| C `Int32Array(16)` | ASR / 有符号比较少一次转换 | LSR / HI / 无符号立即数仍要 `>>> 0` |
| D A + 块内 local hoist | 块内 `let r0=r[0]` 让 JIT 把热寄存器放到 GPR | 只对「块内 rd 集合小」的块有赢面；写回要正确 |

引擎差异（经验，不是测量）：

- **V8**：TypedArray 常量下标很强；稳定对象字段也可能很快。变量下标 + 对象字段 = 灾难。
- **JSC**：对「小整数对象字段」友好，但对 `uint32` 高位（`0x80000000+`）会走 Number；TypedArray 语义更稳。
- **SpiderMonkey**：TypedArray 快路径不如 V8 激进；更要避免多态 helper。

**推荐默认（实现前）：A 作为权威状态；块执行器按 D 做可选 hoist。B 不当权威存储。**

权威布局：

```text
r: Uint32Array(16)     // [HOT]
cpsrWord: number       // [COLD/ABI] MRS/MSR、diff、外部可见
n,z,c,v: 0|1           // [HOT] 分支用，不每条 materialize
t: 0|1                 // [HOT] Thumb
```

`r[15]` 存当前 PC（ARM 流水线 +8/+4 的 guest 可见值在 decoder 里按 ISA 处理，不在寄存器表示层发明第二种 PC）。

### 指令编码（块内）[HOT]

三种块表示：

| | A 对象数组 | B 并列 TypedArray | C packed stream |
|---|---|---|---|
| 内存 | 每条 1 对象 + 指针 | 每字段一列 | 每条 2～3 个 uint32 |
| decode | 贵、分配 | 中 | 中 |
| dispatch | 属性加载 + 多态 | 多次数组读 | 1～2 次 uint32 读后移位 |
| GC | 高 | 低 | 最低 |
| JIT | 差 | 好 | 最好（顺序读） |

**选择 C。**

建议包（可在 bench 后改字宽，不改执行器语义）：

```text
u32 w0:
  bits  0-7   op        // 内部 opcode，不是 ARM 原始
  bits  8-11  cond
  bits 12-15  rd
  bits 16-19  rn
  bits 20-23  rm
  bits 24-25  shiftType
  bits 26     s         // 是否写 flag
  bits 27-31  aux       // 访存大小、写回、链接…

u32 w1:
  imm / offset / shiftAmount / reglist

u32 w2:                 // 仅 Thumb32 / LDM 等需要时存在
  extra
```

块头（稳定形状，每块一个，不在指令循环里分配）：

```text
guestPC, endPC, count, packed: Uint32Array, stride, thumb, execCount
```

### Dispatch [HOT]

| 方法 | 预期 |
|---|---|
| `switch (op)` 单函数 | V8/JSC 对密集小整数 switch 会生成 jump table |
| `handlers[op](cpu)` | **每个 op 一个函数 = 多态调用点，热路径最差选择之一** |
| 嵌套 if 按大类 | 多一次分支，通常不如密 switch |
| `eval`/`new Function` | 禁止 |

**默认：块循环内 `switch (op)`。稀有 op 落到一个 `slowOp()` [COLD]。**  
Stage 4 用 `bench/arm_dispatch` 对比 switch vs 手工分组。若某引擎上 8 路分组更快，再改，不在 Stage 3 猜。

内部 `op` 从 0 起密编：ALU、访存、B、BL、BX、Thumb16、Thumb32-slow。未实现 → trap，不静默当 NOP。

### CPSR [HOT]

| 策略 | 复杂度 | 预期 |
|---|---|---|
| 每条 eager 全 flag | 低 | 浪费：非 S 指令不该算 V |
| 仅 S / CMP 类 eager | 低 | **默认** |
| lazy（记下 a,b,op，分支时再算） | 高 | JS 里「省一次 ADD 的 C/V」通常不够抵「分支处的函数/分支」 |
| 部分 lazy 只懒 V | 中 | 仅当 bench 显示 ADDS 是热点再试 |

**默认：非 S 不更新 N/Z/C/V；CMP/CMN/TST/TEQ/S 立即写 n,z,c,v。不做 lazy。**  
`conditionPassed`：16 种条件直接展开或 `COND_TABLE[cond]`（`Uint8Array` 索引 4-bit 旗标）。两种都进 `bench/arm_branch`。

T 与 NZCV 分开。`BX/BLX` 只改 `t` 和 PC。

### ARM / Thumb 子集 [ABI]

三个 decoder，一个 packed `op` 空间：

```text
fetch
  ├─ t==0 → ARM32 decoder
  ├─ t==1 && 16-bit → Thumb16 decoder
  └─ t==1 && 32-bit 前缀 → Thumb32 decoder
```

| 层 | 内容 |
|---|---|
| core | 数据运算、移位、LDR/STR/B/H/SB/SH、B/BL/BX/BLX、MUL/MLA、PUSH/POP、LDM/STM 常用形 |
| rare slow | UMULL 族、罕见寻址、Thumb-2 宽立即数 |
| trap | 协处理器、未实现 Thumb-2、特权 |

**优先级用 fixtures 的 opcode 直方图决定，不用猜测。**  
工具（Stage 3 先写，仍不算 runtime）：从 MRP 抽 `*.ext`，按 ARM/Thumb 扫，输出 `op → count`。先扫 e2e 点名的 wrapper（约 19–23KB）和 `game.ext`。

缺 Thumb bit：decoder 在 **已知 ExecRegion 内** 且 ARM 译码失败时，允许一次 Thumb 重试。区域外不重试（避免把数据当代码）。

---

## F. Memory model

```text
guest addr
    │
    ├─ [HOT]  主映射 0x00010000 .. +32MB，对齐 → ram32[i]
    ├─ [HOT]  主映射，u8/u16 对齐 → ram8 / ram16
    ├─ [ABI]  table 0x10000..0x10257 作为 *代码* 不走 load，走 bridge
    ├─ [PLATFORM] screen 带 → 写 ram + 标 dirty
    └─ [COLD]  平台带 / SCRRAM / 未对齐 / 未映射 → slow
```

主映射：

```text
main: ArrayBuffer(32MiB)
ram8, ram16, ram32  同 buffer 的 view
```

平台带各用独立 `ArrayBuffer`，**不要**做成 4GB 大数组。

热路径 LDR（内联在 switch case，不是 `read32()`）：

```text
off = (addr - 0x10000) >>> 0
if (off < 0x02000000 && (addr & 3) === 0)
    r[rd] = ram32[off >>> 2]
else
    r[rd] = slowRead32(addr)   // [COLD]
```

未对齐：慢路径按字节拼，LE。  
`DataView` 只给慢路径。

table **数据槽** 是普通 RAM（指针存在 0x10000+4N）。  
table **代码槽** 被执行时不是 load，是 syscall。

屏幕：RGB565 在 guest RAM。写屏幕范围时 `screenDirty = 1` 并记行脏（`Uint8Array(rows)`），不要每像素 hook。

---

## G. Block cache model

不要：

```ts
Map<number, BasicBlock>
new Array(1 << 24) // 32MB 主映射 / 4
```

代码不占满 32MB。wrapper 在 `0x01E80000`，child 在 bump/heap，且会卸载。

**分区直连表 [HOT]：**

```text
ExecRegion[]   // ≤64，线性；lastRegion 缓存
region.blockId: Uint32Array(len>>>2)
blockPool[id]: { packed, count, endPC, thumb }
```

查找：`(pc - base) >>> 2` → id。miss → decode → 填 id。

失效 [ABI]：`readFile` / dump / cacheSync / 模块退役时，对该区间 `blockId.fill(0)`。这替代 `uc_ctl_remove_cache`。

`pc >>> 2` 全局索引 **只** 在单一连续、生命周期稳定的映像上使用。嵌套模块必须按 region。

---

## H. Table bridge model

```text
[HOT] 判定：
  u = pc >>> 0
  if (u - 0x10000 < 600 && (u & 3) === 0) {
      n = (u - 0x10000) >>> 2
      if (execMask[n]) → [ABI] tableEnter(n)
  }

execMask: Uint8Array(150)   // 1=可执行桥，0=数据槽
handlers: 稀疏函数表        // [COLD] 多态可接受
```

禁止 `Map<address, handler>`。

进入后 [ABI]：

1. 填 SP-64 死区（LR/SP 残留）
2. 调 `handlers[n](r0,r1,r2,r3, sp)`
3. `r[0] = ret`
4. `pc = lr; t = lr & 1`

数据槽（91–112、135–136、139–140、142–143、146、23–24 等）`execMask=0`。若 guest 跳进去：当未实现/返回 LR，与 rxgj `hook_low_zero` 同类，不当普通函数。

table 调用相对 ADD 约稀 10³–10⁶ 倍。优化重点是 **判定 4 条整数运算**，不是把 150 个 handler 内联进 ARM 循环。

---

## I. Lua / ARM 分离

### 源码与 fixtures 事实（不是猜测）

1. **Opcode**  
   `mr_opcodes.h`：标准 Lua 5.0 集合 + `OP_BNOT/BAND/BOR/BXOR`（`NUM_OPCODES = OP_BXOR+1`，39 个）。  
   `mr_vm.c` 按位运算把 `mrp_Number`（double）转 `long` 再写回。  
   **仓库 fixtures 没有抽出的 `.mr` 二进制**，因此 **不能** 声称「start.mr 只用了其中 K 个 opcode」。

2. **Mythroad 对 Lua 的修改**  
   - 魔数 `\033MRP` 不是 `\033Lua`  
   - `mrp_Number = double`  
   - 4 个按位 opcode  
   - `COMPATIBILITY01` 注册大量宿主 API  
   - Pluto/`_store` 持久化  
   - iolib 面向 MRP 文件，不是完整 Lua io  
   - 源语言方言（`def`、`||`、`_t`、`string.subV`、`string.pack`）在 **编译期**；运行时吃的是 bytecode

3. **start.mr 实际在干什么**（`unused/start.mr.lua`、`unused/mr_start.lua`）  
   - `_strCom(601)` 读 `cfunction.ext`  
   - `_strCom(800)` load，`801` 转发 event/timer/pause/resume/init  
   - `GetSysInfo`、`file.open`、`string.pack`、`_gc`、`_drawText`  
   - 支付/版本辅助  
   这是 **加载器 + 事件桥**，不是游戏主循环。

4. **纯 Lua 样本**  
   `docs/sample_mr.txt`：`dealevent` / `DrawText` / `GetSysInfo` / `_dispUp`，无 EXT。说明 Lua-only 存在，但 e2e 主体是 EXT 游戏。

5. **EXT-only**  
   存在且一等：`mr_doExt`、`VMRP_EXT`、`arm_ext` smoke、`cfunction.ext` 入口。  
   e2e 里既有「FULL Lua + wrapper」（sanguo、gtxzj），也有「cfunction.ext 私有 loader」为主的包。

6. **解耦**  
   Lua 只通过 `_strCom` / DSM 碰 ARM。ARM 不解释 Lua opcode。  
   **必须解耦。**

### 三种路线

| | Full Lua 5.0-MRP VM | 「MRP subset」opcode | EXT-only 先行 |
|---|---|---|---|
| 兼容 | 覆盖 start.mr / dsm_gm / 纯 Lua | **无直方图则是赌** | 覆盖 `mr_doExt` 与大量游戏，**默认启动器会挂** |
| 成本 | ~39 opcode + GC + 表 + undump，远小于 ARM | 表面小，漏一个 CLOSURE/FORLOOP 就炸 | ARM 可独立验收 |
| 热路径 | 游戏帧内通常只做 801 转发 | 同左 | 无 Lua |

**决定：**

```text
不要在无 .mr 直方图时做 opcode subset。
Lua 与 ARM 完全解耦。
实现顺序：
  1) EXT-only 把 ARM [HOT] 做对（等价 mr_doExt）
  2) 全量 39 opcode + undump + 最小宿主绑定
     （_strCom 800/801/601、GetSysInfo、file、timer、draw、_gc）
  3) 其余 COMPATIBILITY01 按真实 start.mr 追踪加
```

「最小绑定」不是「最小 opcode」。39 个 opcode 比猜 subset 更便宜。  
**不要**把整份 C `mr_vm.c` 机械翻译成逐对象执行器；Lua 自己的热循环用数字/表，但仍是 [COLD] 相对 ARM。

在抽出 e2e 包内 `start.mr` 并统计 opcode 之前，不宣称「可删 POW/TFORPREP」。

---

## J. Browser platform model

### Graphics [PLATFORM]

240×320 RGB565 ≈ 150 KiB。60 Hz 全屏上传 ≈ 9 MB/s 量级，远低于 ARM 解释器。

| 方案 | 240×320 | 何时考虑 |
|---|---|---|
| Canvas2D `ImageData` + `putImageData` | **默认** | 始终先做 |
| dirty 行 → 只转 RGB565→RGBA 脏行 | 便宜 | 与 `Uint8Array(rows)` 一起做 |
| OffscreenCanvas | Worker 时 | Stage 后期 |
| WebGL 纹理 | 放大/滤镜成为瓶颈 | 测量后再上 |
| WebGPU | 不作为 v1 | 不做「现代」选型 |

**不要**每像素 `fillRect`。

### Audio [PLATFORM]

```text
mr_playSound [ABI]
    → 解码到 PCM 环缓（独立于 CPU 循环）
    → AudioWorklet / ScriptProcessor 拉流
```

ARM 循环不碰 `AudioContext`。

### Input [PLATFORM]

```text
DOM → {type, p0, p1} → 队列
Scheduler 在 slice 边界 drain → Lua dealevent 或 ARM code=1
```

### Timer / Scheduler [HOT]/[PLATFORM]

比较：

| 预算 | 优点 | 风险 |
|---|---|---|
| 指令条数 | 可复现 | Thumb 与 table 成本差两个数量级 |
| 时间（4–8ms） | 不卡 UI | 需 `performance.now`，注意精度 |
| 帧（rAF） | 和显示对齐 | 一帧里必须再切分，不能跑满 16ms |

**默认：时间预算为主，指令上限为安全阀。**  
present 只在 rAF。timer 到期只进队列。

Worker：v1 主线程。预留 `postMessage` + `ImageBitmap` / OffscreenCanvas。v1 不要求 `SharedArrayBuffer`。

### VFS [COLD]/[ABI]

```text
MrpArchive     只读，gzip 已解
RamFile        table[104/105]
IdbFs          写、mkdir、下载包
RomBundle      gb12/gb16、dsm_gm
```

路径语义对齐 `dsm.c`：`mythroad/`、`disk/a|b|x`、分隔符归一。  
不要 POSIX fd 全集。VFD `0x7FFF0001+` 仅服务包内只读。

---

## K. Benchmark plan

目录：

```text
bench/
  regs_registers.ts      A vs B vs C vs D
  arm_add.ts
  arm_branch.ts          cond table vs inline；lazy vs eager（若实现实验分支）
  arm_memory.ts          内联 ram32 vs 函数 read32 vs DataView
  arm_load_store.ts
  arm_mul.ts
  thumb16.ts
  block_cache.ts         Map vs region Uint32Array vs 全局大数组
  table_call.ts          空 handler 往返
  memcpy.ts
  dispatch_switch.ts     switch vs 函数表
  real_ext.ts            抽一份 cfunction.ext 跑 N ms
  real_mrp.ts            EXT-only 启动到首帧
```

指标：instructions/s、blocks/s、table/s、memops/s、frame time、`performance.memory`（Chrome）、启动 ms。  
浏览器：Chrome、Safari、Firefox、Edge。同一 harness，禁止只对 V8 调参。

**在这些数字出来之前，不把 B 寄存器或 WebGL 写成「已选定」。**

---

## L. Differential testing plan

```text
test/unicorn/          仅 Node/桌面
  禁止 import 进 src/platform 与 production bundle
```

协议：

```text
同一：内存镜像、r[0..15]、cpsr、入口 PC
跑 N 条或直到 table/stop
比较：r、cpsr、pc、指定内存区间
```

种子：ALU 单测 → 访存 → 块缓存 → 真实 EXT 片段。  
table 调用：两边都 trap 到同一 stub，比的是 **进入 table 前的状态**。  
JS 与 Unicorn 的 Thumb 修正规则必须写进测试说明，避免把「缺 T bit」当 diff 失败。

---

## M. 性能风险排名

| 排名 | 项 | 为何 | 值不值得先优化 |
|---|---|---|---|
| 1 | 指令对象 / 多态 handler | 直接打爆 JIT 与 GC | **必须在设计期消灭** |
| 2 | 每次访存走通用 `read32` | 每条 LDR 多个 if+call | **内联快路径** |
| 3 | `Map` 块缓存 | 热 PC 查找 | **region + Uint32Array** |
| 4 | 每条指令算满 flag | 白算 V | **仅 S** |
| 5 | 整 heap 写钩扫 GOT | Unicorn compat 税 | **删；API 点恢复** |
| 6 | 每 block 扫全部 region 修 R9 | 替代 UC_HOOK_BLOCK | **只在 BX/BLX/call 边界** |
| 7 | table 判定 | 便宜，但写错会每条指令变慢 | 整数范围比较即可 |
| 8 | memcpy/画图 | 单次大 | 用 TypedArray `copyWithin` / `set` |
| 9 | Canvas | 240×320 几乎不是瓶颈 | **先 2D，勿先 WebGPU** |
| 10 | Lua opcode | 相对 ARM 循环不是第一瓶颈 | 先做对，再谈 |
| 11 | 寄存器 A vs D | 可能 10–30% | **bench 后再 hoist** |

理论拆分（一帧）：

```text
CPU ≈ dispatch + mem + branch + (偶发) table + present
```

240×320 present ≪ 解释器。先把 dispatch/mem/block 做成「像小整数 VM」，再谈 Worker/WebGL。

---

## 状态机：Nested EXT [ABI]

平面字段，不要类继承：

```text
load wrapper → owners.wrapper = …
register first child → primary = active = child
timerStart → timer = 调用者
open modal child → active = child2；suspend++；timer 可能仍是 wrapper
close child → 退役记录；active = primary；恢复 screen 快照
```

`arm_ext_call` 选 helper：保持 Stage 1 表（0 primary，1 wrapper，2 timer owner）。

R9：

```text
call 入口：R9 = P.ER_RW
BX/BLX 目标落入其他 ExecRegion：R9 = 该 region.rwBase
返回 nested_return：R9 = outerR9
```

GOT：只在 memcpy / memset / memmove / read / readFile / dump restore 后，对 **已记录 GOT 窗** 写回 snapshot。禁止每次 STR。

---

## 明确不做什么（本阶段）

- 完整 ARM / 完整 Thumb-2
- 完整 POSIX
- 浏览器 Unicorn
- 第一版 JIT / WASM backend（只留 `CpuBackend` 接口一层，空实现不算工程）
- 为 Lua 先写 parser（`.mr` 是 `\033MRP` bytecode；源方言是编译器的事）
- 把 `arm_ext_call` 550 行机械搬进 TS

---

## Stage 2 冻结结论

1. 热路径 = packed 块 + `Uint32Array` 寄存器 + 内联 RAM + `switch(op)`。  
2. 块缓存 = 每映像 `Uint32Array` 直连，不是 `Map`。  
3. table = 整数范围 + `execMask[n]`。  
4. R9 只在控制流/调用边界更新；R10 普通寄存器。  
5. Lua：与 ARM 解耦；**不做无数据的 opcode subset**；产品顺序 EXT-only → 全 39 opcode VM + 最小绑定。  
6. 图形：Canvas2D；调度：时间片 + rAF。  
7. 一切「谁更快」用 `bench/` 在三引擎上测，不在本文拍板寄存器微结构的最终赢家。

Stage 2 结束。确认后 Stage 3 只做 GuestMemory + ARMCPU + decoder + interpreter 的纯 ARM 测试，不接 MRP。
