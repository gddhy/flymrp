# Stage 5-C.10F：table[17] / sprintf_ ABI Forensics

状态：**COMPLETE**（只取证）。**未实现 table[17] / `sprintf_`。Stage 5-D NOT STARTED。**

```text
READ-ONLY FORENSICS
first production blocker = table[17]
```

禁止项（本阶段均未做）：table[17] handler、改 sprintf buffer、假 length、`%d` only 实现、sprintf-js / `util.format` / printf npm / host libc sprintf / ffi / forensic bypass、改 table[130]/[38]/[33]、进入 5-D。

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   BLOCKED / LIVE REACHED
```

---

## Q1. table17 的准确源码 identity/signature？

**CONFIRMED**

```text
slot:      17
identity:  sprintf_
C:         int sprintf_(char* buffer, const char* format, ...);
stub:      0x00010044 = mr_table + 17*4
```

- `mythroad.c:452`：`_mr_c_function_table[17] = (void*)sprintf_;`
- MINI `mythroad_mini.c:215` 同样挂 `sprintf_`
- `printf.h:81`：`int sprintf_(char* buffer, const char* format, ...);`
- `mr.h:106`：`#define SPRINTF sprintf_`

不是 libc `sprintf`。

---

## Q2. sprintf_ 是 libc wrapper 还是自定义 formatter？

**CONFIRMED：自定义 formatter**（mpaland/printf commit `d3b9846`）。

```c
int sprintf_(char* buffer, const char* format, ...)
{
  va_list va;
  va_start(va, format);
  ret = _vsnprintf(_out_buffer, buffer, (size_t)-1, format, va);
  va_end(va);
  return ret;
}
```

`printf.h` 对本树关闭：

```c
#define PRINTF_DISABLE_SUPPORT_FLOAT
#define PRINTF_DISABLE_SUPPORT_EXPONENTIAL
#define PRINTF_DISABLE_SUPPORT_PTRDIFF_T
```

`PRINTF_SUPPORT_LONG_LONG` **未** disable（默认开）。

parser：`%[flags][width][.precision][length]type`

- flags：`-+ #0`
- width：十进制或 `*`
- precision：`.` + 十进制或 `*`
- length：`h` / `hh` / `l` / `ll`
- type：`d i u x X o b c s p %`

未知 specifier：**只输出该字符本身且不消耗 vararg**（与 talkcat `%m%d.jpg` → `m5.jpg` 一致，不是 glibc `%m`）。

`%s`：按 C 字节串逐字节 `out(*p++)`，无 GBK/UTF-8 转换。  
`%c`：`(char)va_arg(va, int)`。  
`%p`：`FLAGS_ZEROPAD | FLAGS_UPPERCASE`，宽 `sizeof(void*)*2`。  
`%d/%i`：`va_arg(int)`，负值走绝对值 + 符号。  
`%u/%x/%X`：`unsigned int`；`%X` 大写。  
`%%`：输出一个 `%`，不消耗参数。

终止：写 `'\0'`。返回值是**已写字符数，不含 NUL**。

溢出：`maxlen = (size_t)-1`，无界写入。注释要求 buffer 必须够大。`_out_buffer` 仅在 `idx < maxlen` 时写入。

整数边沿（源码路径，本阶段未跑 host）：

| 输入 | specifier | 预期输出 |
|---|---|---|
| `0xffffffff` as `int` | `%d` | `-1` |
| `0x80000000` as `int` | `%d` | `-2147483648`（INT_MIN；`0 - value` 在 C 里对 signed INT_MIN 是 UB，ARM32 二补码通常仍得到 `0x80000000` 无符号幅度） |
| `0xffffffff` | `%u` | `4294967295` |
| `0xffffffff` | `%x` | `ffffffff` |
| `0xffffffff` | `%X` | `FFFFFFFF` |

---

## Q3. 当前 LIVE `%d` 参数是否 CONFIRMED 来自 R2=0？

**CONFIRMED。**

调用点 `0x01e9a864`：

```text
0x01e9a864  b530  PUSH {r4, r5, lr}
0x01e9a866  1c04  MOV  r4, r0          ; 保存 incoming
0x01e9a868  2000  MOVS r0, #0
0x01e9a86a  b089  SUB  sp, #0x24
0x01e9a86c  4915  LDR  r1, [pc, #0x54]
0x01e9a86e  9002  STR  r0, [sp, #8]
0x01e9a870  9001  STR  r0, [sp, #4]
0x01e9a872  1c22  MOV  r2, r4          ; %d = incoming r0
0x01e9a874  4479  ADD  r1, pc          ; format PIC
0x01e9a876  4b14  LDR  r3, [pc, #0x50] ; GOT off 0x5c
0x01e9a878  ad03  ADD  r5, sp, #0xc    ; buffer
0x01e9a87a  444b  ADD  r3, r9
0x01e9a87c  681b  LDR  r3, [r3]        ; stub 0x00010044
0x01e9a87e  1c28  MOV  r0, r5
0x01e9a880  4798  BLX  r3
```

父函数 `0x01e9a8d8` 在 `BL 0x01e9a864` 前把 `r0 = [ER_RW+0x1e0c]`。LIVE `[0x00202028] = 0`。  
LIVE：`r4=0`，`r2=0`。所以 `%d = R2 = 0`。

`R3 = 0x00010044` **不是** vararg：字面量 `0x5c` + `ADD r3, r9` + `LDR r3, [r3]` + `BLX r3`。GOT `[ER_RW+0x5c] = 0x00010044`。

---

## Q4. 当前调用有无 stack varargs？

**CONFIRMED：无。**

format 只有一个 `%d`。AAPCS 第一个 vararg 在 R2。R3 是 stub。

LIVE `SP = 0x01e7ff68`：

```text
[SP+0]  = 0x01ea7cf7   ; 帧内残留（getTime wrap LR），不是 sprintf 参数
[SP+4]  = 0            ; wrap 里 STR #0，留给后续 helper
[SP+8]  = 0            ; 同上
[SP+12] = buffer 首字  ; buffer = SP+0xc，不是 vararg
```

---

## Q5. 当前调用预期写出的字节是什么？

**INFERRED**（本阶段禁止 host 写入 buffer）：

```text
res_lang0.rc\0
```

14 字节（含 NUL）。format 为纯 ASCII **CONFIRMED**。`%d=0` **CONFIRMED**。字符串本身由自定义 `sprintf_` 推导，未在 guest 中观察到写入后内容。

调用前 buffer 16 字节残留：

```text
a0 ff e7 01 f7 7c ea 01 a0 ff e7 01 f7 7c ea 01
```

未清零。

buffer `0x01e7ff74`：

- GuestMemory 主窗口 `0x00010000` + 32MiB（内含 EXT_STACK `0x01e00000`–`0x01e80000`）
- 栈 local：`SUB sp,#0x24` 后 `ADD r5,sp,#0xc` → 可写 local **24** 字节
- 到 stack top `0x01e80000` 还有 **140** 字节（`0x8c`）
- 高于当前 SP（`buffer = SP+12`），不与 SP 指向的字重叠
- `"res_lang0.rc\0"` 放得下

---

## Q6. guest 是否使用 sprintf 返回长度？

**CONFIRMED：忽略。** 当前 startup 依赖 **formatted buffer**，不依赖 return length。

返回点 `0x01e9a882`：

```text
0x01e9a882  2200  MOVS r2, #0      ; 不读 r0
0x01e9a884  9200  STR  r2, [sp]
0x01e9a886  1c29  MOV  r1, r5      ; r1 = buffer
0x01e9a888  2000  MOVS r0, #0      ; 覆盖返回长度
0x01e9a88a  aa02  ADD  r2, sp, #8
0x01e9a88c  ab01  ADD  r3, sp, #4
0x01e9a88e  BL    0x01ea8cdc
```

---

## Q7. formatted buffer 后续被谁消费？

**CONFIRMED 立即消费者**（静态指令；本次 run 停在 sprintf，未执行）：

1. `0x01ea8cdc`：`r0=0`，`r1=buffer`，`r2=&[sp+8]`，`r3=&[sp+4]`。本地 helper：检查首字节 `'*'` / `'$'`，随后 BLX 对象函数指针。
2. 若该 helper 返回非 0：`table[26]` `asm_mr_printf`，format `"Failed to read resource: %s\n"`，`%s` = 同一 buffer。GOT `[ER_RW+0x20] = 0x00010068`。

**UNKNOWN（本次未执行）**：`0x01ea8cdc` 是否走到 `table[125] _mr_readFile` / `fopen` / `strcmp`。不要从文件名猜测。buffer 用途是 **资源文件名参数**（指令把 r1 交给该 helper）——这是 CFG，不是“一定打开成功”。

父链 **CONFIRMED**：

```text
0x01ea7f7e  MOVS r0, #0x55
0x01ea7f80  BL   0x01e9a8d8
0x01e9a8ec  LDR  r0, [ER_RW+0x1e0c]   ; lang id = 0
0x01e9a8f8  BL   0x01e9a864            ; sprintf wrap
```

`0x01e9a864` 只有这一处 BL xref。

---

## Q8. 真实 cfunction.ext 一共有多少 table17 callsite？

**CONFIRMED：12。**

扫描：`LDR rd,[pc,#imm]` 字面量 `0x5c`，随后（允许间隔）`ADD rd,r9` / `LDR rd,[rd]` / `BLX rd`。  
未发现 `LDR [rn,#0x44]`+`BLX`，也未发现 `LDR #0x38` / `ADD #0x40` / `LDR #4` / `BLX` 的 table[17] 序列。本 pack 全部走 ER_RW GOT `+0x5c`。

| BLX | format | vararg | 位置 | 返回值 | 上下文 |
|---|---|---|---|---|---|
| `0x01e97f2c` | `filesize=%d Bytes` | 1×`%d` | R2=`[sp,#4]` | 覆盖 | STATIC |
| `0x01e9a880` | `res_lang%d.rc` | 1×`%d` | R2=r4=lang | 覆盖 | **LIVE** |
| `0x01e9e1d4` | `%d` | 1×`%d` | R2=`[r6,#4]` | buffer | STATIC |
| `0x01e9e312` | `%d` | 1×`%d` | R2=`[r7,#0x20]` | buffer | STATIC |
| `0x01e9e348` | `%d` | 1×`%d` | R2=`[r0,#4]` | buffer | STATIC |
| `0x01e9e38e` | `%d` | 1×`%d` | R2=`r0<<3` | buffer | STATIC |
| `0x01e9e3a6` | `%d` | 1×`%d` | R2=`[r0,#8]` | buffer | STATIC |
| `0x01e9f050` | `%d` | 1×`%d` | R2=incoming r0 | buffer | STATIC |
| `0x01ea82b6` | `%d` | 1×`%d` | R2=`[got+4]` | buffer | STATIC |
| `0x01eadbf0` | `%s/chn%d` | `%s` R2 + `%d` R3 | 无 stack | buffer | STATIC |
| `0x01eadccc` | `%s/chn%d` | `%s` R2 + `%d` R3 | 无 stack | buffer | STATIC |
| `0x01eaddbc` | `%d` | 1×`%d` | R2=`[sp,#0x10]` | buffer | STATIC |

`%s/chn%d`：`R2` PIC `"gsidbak"`，`R1 = R2-0x0c`。两参数，R2+R3，无 stack vararg。

---

## Q9. 实际出现哪些 format specifier？

**table[17] callsite（CONFIRMED）：**

```text
%d   12/12
%s    2/12   ("%s/chn%d")
%x    NOT observed
%X    NOT observed
%u    NOT observed
%c    NOT observed
%%    NOT observed
%p    NOT observed
%i    NOT observed
width/precision / *   NOT observed
stack varargs (3+)    NOT observed
```

pack 内其它 `%` 字符串（如 `"Failed to read resource: %s\n"`、`"SDKv%d.%d.%d.%2d(%dv%d%s)"`）的 PIC 在 **r0**，是 `table[26] printf_` / 其它 helper，**不是** table[17]。不要把它们算进 sprintf 子集。

---

## Q10. startup 路径最低需要哪些 specifier？

```text
LIVE startup required:  %d
STATIC future observed: %d, %s
NOT observed (table[17]): %x %X %u %c %% %p %i width/precision stack varargs
```

当前真实启动只碰 `res_lang%d.rc`。若以后走到 `gsidbak` 路径，还需要 `%s`（字节拷贝）和第二个寄存器参数。

---

## Q11. rxgj bridge 如何处理 guest ARM varargs？

**CONFIRMED。** `aex_t017` **不**调用宿主 `sprintf_`，也 **不**重建整次调用的 host `va_list`。

```c
ret = format_arm(m, buf, sizeof(buf), arm_str(m, r1), 2);  /* first_arg = 2 → R2 */
fmt_dst = arm_ptr_span(m, r0, strlen(buf)+1);
if (fmt_dst) memcpy(fmt_dst, buf, strlen(buf)+1);
```

`arg_read(m, n)`：

- `n < 4` → `Rn`
- `n >= 4` → `[SP+(n-4)*4]`

`format_arm`：walk format，按 AAPCS 拉参数；`%s` 用 `arm_str` 把 guest 指针映成 host 字节串；`%lld` 按 AAPCS 8 字节偶奇寄存器对。未知 spec 只输出该字符、不消耗参数。然后对**单个** specifier 用 host `snprintf` 写到 tmp。

边界：rxgj 的 `%d` 把 `uint32 av` 交给 64-bit host `snprintf`。这与 32-bit `int` **不一定同构**（尤其 `0x80000000`）。flymrp 若跟这条桥，应在 JS 里按 int32 格式化，而不是把 guest 字直接丢给 host libc。

1024 字节 host 临时缓冲；guest 可映射才写回。ARM32 guest varargs 与 64-bit host varargs **不同构**；rxgj 用 guest-aware reader 避开了整次 `va_list` 转发，但仍依赖 host `snprintf` 的单 spec 行为。

---

## Q12. flymrp 是否可以用“guest-aware formatter”实现，而不构造 host va_list？

**CONFIRMED 可行。** rxgj Unicorn 桥已经这样走。JS 侧读 R0=buffer、R1=format、从 R2/R3/`[SP+…]` 取 vararg，按 mpaland 子集写 guest 字节，不必 `sprintf-js` / `util.format` / ffi / host `va_list`。

本阶段 **不实现**。

---

## Q13. 当前是否已有足够证据实现 table17 的最小真实子集？

**CONFIRMED：证据足够描述 LIVE 最小子集（`%d` + R2 + 无 stack vararg + 忽略返回长度 + 写 NUL）。**  
STATIC 还观察到 `%s`。实现阶段应覆盖 LIVE `%d`，并决定是否一并带上已扫描到的 `%s`。

本阶段 **禁止实现**。生产路径仍停在 table[17]。

---

## 编码

当前 format `"res_lang%d.rc"`：**CONFIRMED 纯 ASCII**。  
`sprintf_` 的 `%s` 是字节拷贝，不做 GBK/UTF-8/Latin-1 转换。不要把 Lua 字符串编码套进 C sprintf。

STATIC `%s` 实参 `"gsidbak"` 也是 ASCII。其它 `%s` 路径若出现非 ASCII guest 串，仍应按字节写出。

---

## 生产状态（未变）

```text
production mr_table:
  25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17

first production blocker = table[17]
Stage 5-D: NOT STARTED
```
