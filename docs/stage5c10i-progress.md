# Stage 5-C.10I：Implement table[100] / pack_filename data-slot semantics + Real MRP Re-run

状态：**COMPLETE**（只修 `table[100]` producer / storage）。**未实现 table[40] / `mr_open`。Stage 5-D NOT STARTED。**

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table40   BLOCKED / LIVE REACHED

first production blocker = table[40]
```

区别只是 table[40] 的参数现在正确：

```text
before: R0 → ""
after:  R0 → "gssjxz.mrp"   (table[100] buffer, NUL-terminated)
        R1 → 1              (MR_FILE_RDONLY)
        R6 → "res_lang0.rc" (资源名，不是 pack 路径)
```

禁止项（本阶段均未做）：实现 `table[40]`、`mr_open`、table[41]+、host filesystem、IndexedDB、把 R6 / sprintf buffer 写入 table[100]、硬编码 `app.mrp` / `gssjxz.mrp`、为保旧地址继续用 8-byte slot、Stage 5-D。

---

## Q&A

| | |
|---|---|
| **Q1** table100 的真实类型/大小是什么？ | `char pack_filename[128]`。`_mr_c_function_table[100] = (void*)pack_filename`。不是 function slot，不是 pointer-to-pointer，不是 u32 scalar |
| **Q2** flymrp 是否从 8-byte scalar slot 修成 128-byte char buffer？ | **是。** `dataSlotAllocSize(100) = 128`。table[100] 存 guest 地址，指向 128 字节可写缓冲 |
| **Q3** pack_filename 在什么时候被写入？ | `bindExt`：`ExtRuntime` 构造分配 table[100] → `MrTableBridge.install()` → `setPackTableName(packName)`。发生在 `_strCom(800)` load 之前，更在 code0 / table[40] 之前。不是 lazy patch，不在 `mr_open` handler 里补写 |
| **Q4** 数据来自 runtime 的哪个真实字段？ | `MythroadRuntime.packName`。`loadMrp` 设为 `archive.header.filename \|\| "app.mrp"`。与 Lua `PackName` / `packname` 同源。不是 fixture 路径，不是 R6，不是 sprintf buffer |
| **Q5** 当前 app 实际写进去的字符串是什么？ | **`"gssjxz.mrp"`**（MRP header filename / pack identity）。不是 `test/fixtures/real/app.mrp`，不是 `"app.mrp"` |
| **Q6** 是否正确 NUL terminate？ | **是。** `memset(dst,0,128)` + 最多 127 字节 copy（rxgj `snprintf(dst, 128, "%s", name)`） |
| **Q7** 是否有任何 R6 / sprintf workaround？ | **否。** LIVE R0 来自 table[100] 缓冲地址 `0x00200058`。R6 仍是 `"res_lang0.rc"` |
| **Q8** LIVE 到 table40 时 R0 现在是什么字符串？ | **`"gssjxz.mrp"`** |
| **Q9** table40 的 R1 是否仍是 `MR_FILE_RDONLY`？ | **是。** `R1=1` |
| **Q10** first production blocker 是否仍为 table40？ | **是。** `UNKNOWN_REQUIRED_SLOT = 40`。正确结果 |
| **Q11** table100 扩容是否改变其它关键地址？ | **是，合理布局平移 +0x78（120 字节 = 128−8）。** table[100] 指针仍是 `0x00200058`（它前面的 data slot 仍各 8 字节）。P `0x00200100`→`0x00200178`。ER_RW `0x0020021c`→`0x00200294`。helper `0x01ea5e9d` **不变**。rwLen `19952` **不变**。ARM insn `221` / Lua insn `71` **不变** |
| **Q12** 若改变，是否是 deterministic / 合理布局变化？ | **是。** 5 次启动 fingerprint 含 pack filename / P / helper / ER_RW / rwLen / insn / mr_table sequence，全部一致 |
| **Q13** 是否实现任何 file API？ | **否。** 无 `mr_open` / VFD / RB tree / table[41]+ |
| **Q14** 是否添加 forensic bypass？ | **否** |
| **Q15** 5 次启动是否 deterministic？ | **是** |

---

## rxgj 绑定（按源码，不按名字设计）

```c
// mythroad.c
char pack_filename[MR_MAX_FILENAME_SIZE];  // 128
_mr_c_function_table[100] = (void*)pack_filename;

// arm_ext_executor.c  arm_ext_set_pack_table_name
memset(dst, 0, 128);
snprintf(dst, 128, "%s", name ? name : "");
write_table_entry(m, 100, slot);  // 复用已有 buffer 指针
```

超长：`snprintf` 截断到 127 字符 + NUL。再 set 短名时先 `memset` 整块，旧尾部不可见。

启动写入来源（rxgj）：

```text
arm_ext_set_pack_table_name(m, m->pack_alias[0] ? m->pack_alias : mr_get_pack_filename())
```

`pack_alias` 来自 native `mr_get_pack_filename()`：若绝对路径且在 cwd 下则用相对后缀，否则 basename，再 `dsm_host_path_to_guest`（仅 `FLAG_USE_UTF8_FS` 时 UTF-8→GBK）。

**flymrp 没有宿主 MRP 路径，也没有 `FLAG_USE_UTF8_FS`。** 当前 pack identity 就是 `MythroadRuntime.packName`（MRP header filename）。对本 fixture 它不是绝对路径，因此写入内容 = `packName` 原样。不实现 cwd 相对化 / UTF-8→GBK。

---

## 生命周期

```text
loadMrp → packName = header.filename
  ↓
_strCom(800) → new ExtRuntime()
  table[100] 分配 128 bytes，全 0
  ↓
bindExt
  MrTableBridge.install()   // 不注册 slot 100 handler
  setPackTableName(packName)
  ↓
rt.load(cfunction) / code6 / code0
  ↓
guest _mr_readFile
  LDR r5, table[100]
  R0 = pack_filename
  R1 = MR_FILE_RDONLY
  → table[40] BLOCKED
```

---

## 布局变化（允许）

```text
table[100] ptr   0x00200058  (unchanged; 第 12 个 data slot，前 11 个仍是 8-aligned)
P                0x00200100 → 0x00200178   (+0x78)
ER_RW            0x0020021c → 0x00200294   (+0x78)
helper           0x01ea5e9d  unchanged
rwLen            19952       unchanged
ARM insn @40     221         unchanged
Lua insn         71          unchanged
mr_table seq     25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40
```

没有为了保住旧 P/ER_RW 而继续用错误的 8-byte slot。

---

## LIVE table[40]

```text
PC     0x000100a0
LR     0x01ea89e7
SP     0x01e7ff00
R0     0x00200058  "gssjxz.mrp"
R1     0x00000001  MR_FILE_RDONLY
R2     0x000100a0
R3     0x01e7ff6c
R5     0x00200058  同 table[100]
R6     0x01e7ff74  "res_lang0.rc"
R7/R9  0x00200294  ER_RW
insn   221
```

`table40 filename = "gssjxz.mrp"`

R0 来源 = table[100] buffer，不是 host workaround。

---

## inventory

```text
mr_table/100/pack_filename
  128-byte guest data slot
  populated from current pack identity/path according to
  rxgj arm_ext_set_pack_table_name semantics
```

不是 function ABI，不是 filesystem API，不是 `mr_open` support。

C 计数：27 → **28**。

---

## Stage 5-D

**NOT STARTED。**
