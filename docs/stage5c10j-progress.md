# Stage 5-C.10J：Current-Pack File ABI Forensics + Minimal Read-Only Handle Design

状态：**COMPLETE**（只取证 + 设计）。**未实现 table[40] / 41+ / handle backend。** Stage 5-D **NOT STARTED**。

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table100  PASS / DATA SLOT
table40   BLOCKED / LIVE REACHED

first production blocker = table[40]
```

本阶段禁止项均未做：table40 handler、fake handle、fake read/seek、host/Node fs、IndexedDB、save file、write mode、forensic production bypass。

---

## 核心结论

真实 `_mr_readFile` 打开的是 **当前 MRP 容器文件**（`pack_filename` = `"gssjxz.mrp"`），然后自己 seek/read 解析目录并取出 `"res_lang0.rc"`。

不要把 table[40] 接到包内成员 VFS。最小未来实现是：

```text
filename == runtime.packName  &&  mode == MR_FILE_RDONLY
    → 只读字节流，backing = MRPArchive.data（原始容器 bytes）
```

---

## File slot inventory（rxgj FULL `mythroad.c` `_mr_c_function_table`）

42 = **info**，44 = **read**。不能按 POSIX 顺序猜。

```text
slot  symbol                         C signature
39    mr_ferrno                      int32 mr_ferrno(void)
40    asm_mr_open / mr_open          int32 mr_open(const char *filename, uint32 mode)
41    asm_mr_close / mr_close        int32 mr_close(int32 f)
42    asm_mr_info / mr_info          int32 mr_info(const char *filename)
43    asm_mr_write / mr_write        int32 mr_write(int32 f, void *p, uint32 l)
44    asm_mr_read / mr_read          int32 mr_read(int32 f, void *p, uint32 l)
45    asm_mr_seek / mr_seek          int32 mr_seek(int32 f, int32 pos, int method)
46    asm_mr_getLen / mr_getLen      int32 mr_getLen(const char *filename)
47    asm_mr_remove / mr_remove      int32 mr_remove(const char *filename)
48    asm_mr_rename / mr_rename      int32 mr_rename(const char *oldname, const char *newname)
49    asm_mr_mkDir / mr_mkDir        int32 mr_mkDir(const char *name)
50    asm_mr_rmDir / mr_rmDir        int32 mr_rmDir(const char *name)
51    asm_mr_findStart / mr_findStart int32 mr_findStart(const char *name, char *buffer, uint32 len)
52    asm_mr_findGetNext / mr_findGetNext int32 mr_findGetNext(int32 search_handle, char *buffer, uint32 len)
53    asm_mr_findStop / mr_findStop  int32 mr_findStop(int32 search_handle)
```

`fixR9.h`：`#define asm_mr_* mr_*`。

当前 `_mr_readFile` EFS 成功路径需要的 file slot：**40 / 44 / 45 / 41**。  
**不需要**：39 / 42 / 43 / 46–53。

---

## Guest `_mr_readFile` pack-file 调用链（静态 CFG）

函数：`0x01ea8cdc` … `POP PC 0x01ea91c8`。

LIVE：`pack_filename[0] == 'g'`，不是 `*` / `$`。`0x01ea8dec e04f` 无条件跳到 open：

```text
mr_open(pack_filename, MR_FILE_RDONLY)     table[40]  LIVE
    ↓ 成功：R0 ≠ 0，保存到 r5
memset(headbuf, 0, 16)                    table[14]  已实现
mr_read(f, headbuf, 16)                   table[44]  必须恰好 16
    magic == 1196446285 ("MRPG" LE)
    FileStart > 232  → 本 fixture FileStart=5728
mr_malloc(indexlen)                       table[0]   已实现
    indexlen = FileStart + 8 - ListStart
mr_seek(f, ListStart-16, MR_SEEK_CUR)     table[45]
mr_read(f, indexbuf, indexlen)            table[44]  必须恰好 indexlen
目录循环：memcpy / memset / strcmp         table[3] / [14] / [10]
    比较资源名 "res_lang0.rc"（R6）
mr_free(indexbuf)                         table[1]   未实现（非 file slot）
mr_malloc(file_len)                       table[0]
mr_seek(f, file_pos, MR_SEEK_SET)         table[45]
loop mr_read until file_len               table[44]  inline BLX，nTmp<=0 失败
mr_close(f)                               table[41]
```

PIC wrapper → slot（ADD #0x80 + LDR）：

```text
0x01ea89d8  table+0xa0  slot 40  mr_open
0x01ea8c30  table+0xb0  slot 44  mr_read
0x01ea6e18  table+0xa4  slot 41  mr_close
0x01ea9304  table+0xb4  slot 45  mr_seek
```

host `mythroad.c` 的 `#if 1 mythroad_readFile(filename)` **不在 guest cfunction.ext 里**。  
guest 非 `*`/`$` 时直接 `mr_open(pack_filename)`。LIVE 已到达 table[40] 证实这一点。

---

## Handle ABI（rxgj `file_lib.c my_open`，guest 可观察）

```text
width:            int32
allocation:       filef_count++；RB tree key=id, data=host fd
first valid:      1
0 reserved:       yes（失败；也避免 stdin fd=0）
not:              host fd itself / pointer-derived / MRP_VFD_BASE
reuse:            仅当 close(max_id) 时 filef_count--
close:            从 map 删除；成功 MR_SUCCESS(0)；invalid / double close → MR_FAILED
```

EXT `mrp_vfd_open` 是 **另一套**（`0x7FFF0001+`，pack **成员** cache fallback，seek 会 clamp）。  
current-pack alias **不要**抄 VFD / 不要接到包内成员。

flymrp 不需要复刻 RB tree。当前路径同时只开 1 个 pack handle：从 1 起的正整数即可。

---

## Read ABI（`mr_read` / `my_read`）

```c
int32 mr_read(int32 f, void *p, uint32 l);
// R0=f  R1=p  R2=l
```

```text
return:           实际字节数（int32）
EOF:              0
short read:       允许
requested>remain: 返回 remaining
zero-length:      0
invalid handle:   MR_FAILED (-1)
unmapped dest:    EXT aex_t044 → MR_FAILED（不写）；host my_read 无保护
```

`_mr_readFile` 对 header/index 要求 **恰好** 请求长度；payload 循环允许 short read，但 `nTmp <= 0` 失败。

---

## Seek ABI（`mr_seek` / `my_seek`）

```c
int32 mr_seek(int32 f, int32 pos, int method);
// R0=f  R1=pos(signed)  R2=method
```

Mythroad 常量（不要套 POSIX 名字当 ABI 文档，虽然数值碰巧相同）：

```text
MR_SEEK_SET = 0
MR_SEEK_CUR = 1
MR_SEEK_END = 2
```

```text
success:          MR_SUCCESS (0)
failure:          MR_FAILED
beyond EOF:       my_seek/lseek 成功，不 clamp（VFD 会 clamp — 不要抄）
negative result:  lseek 失败 → MR_FAILED，offset 不变
```

当前路径：header 读完后 `seek(ListStart-16, CUR)`；命中目录后 `seek(file_pos, SET)`。

---

## Close ABI

```c
int32 mr_close(int32 f);
```

成功 0，失败 -1。`_mr_readFile` 在 open 成功后的几乎所有失败路径和成功路径都会 close。open 失败（f==0）不 close。

---

## info / getLen

`_mr_readFile` EFS 路径 **不调用** table[42] / [46] / [39]。长度来自 MRP 目录 `file_len` 字段。

```text
NOT REQUIRED on current startup path
```

---

## 原始 MRP bytes

```text
Q: 能否把 "gssjxz.mrp" 映射成当前 archive 原始 bytes？
A: 能。CONFIRMED

source:     MRPArchive.data  （parse() 保存同一 Uint8Array 引用，无 copy）
lifetime:   直到下次 loadMrp / runtime 销毁
length:     与 loadMrp 传入 bytes 相同（本 fixture 382778）
immutable:  parse 不改 data；readFile() 对成员可能 gunzip 出新缓冲，.data 仍是容器
```

不要再从 host path 读 `test/fixtures/real/app.mrp`。  
`vfs.exists("gssjxz.mrp")` 为 false：那是包内目录，不含容器自身。

---

## current-pack alias 设计

```text
A. filename == runtime.packName && mode == MR_FILE_RDONLY
   → ReadOnlyGuestFile { bytes: archive.data, pos: 0 }
   → 正整数 handle（建议从 1 起）
   → seek/read 操作容器字节流
   → close 使 handle 失效

B. 其它 filename / WRONLY / RDWR / CREATE
   → UnknownAbiError / unsupported
```

禁止 `any filename → current MRP`。  
禁止 table[44] 调用 `archive.getResource` / `readFile(name)`。guest 要的是文件字节流。

与 rxgj 对 guest 的可观察行为一致（open 正整数、seek/read 得到原始 .mrp bytes、close 失效）：

```text
SUPPORTED DESIGN / INFERRED COMPATIBLE
```

不是声称源码内部 RB tree / host path 相同。

确定性：只用已在内存中的 archive bytes。不用 Date / cwd / browser File / network / Node fs。

统一 `Map<handle, {bytes, pos}>` backend，不要逐个 fake slot。

后续非 file blocker（本阶段不实现）：table[1] `mr_free`、table[3] memcpy、table[10] strcmp。payload 读完后还可能 `mr_get_method` / unzip。

---

## 和 MrpArchive parser 对照

guest 新版路径与 `MRPArchive.parse` 的 index 布局相同：

```text
bytes[0..15]   magic / FileStart / FileLen / ListStart
index          ListStart .. FileStart+8
entry          nameLen, name, file_pos, file_len, reserved
payload        位于 file_pos，长度 file_len（可能 gzip；guest 自己 unzip）
```

host parser 可以继续给 Lua / table[125] 用。table[44] 不得偷用它当资源 API。

---

## Guest `_mr_readFile` 入口寄存器（LIVE）

host C 是 `_mr_readFile(filename, filelen, lookfor)`。本 pack 的 cfunction.ext 入口 **不是** 那组 AAPCS：

```text
r0 = 0                 NULL pack → prologue 从 table[100] 取 pack_filename
r1 = "res_lang0.rc"    资源名，随后保存在 R6
r2 = 0x01e7ff70        filelen*
[sp] = 0
```

r0==0 时 `LDR r5, [table+0x190]` = table[100]。之后 `mr_open(r5, RDONLY)`。

host C 的 `lookfor` 不在 r2。`[sp]=0` 标 **INFERRED** 加载内容（不是 exists/rom pointer）。

---

## Q&A

| | | |
|---|---|---|
| **Q1** open 成功后静态会调用哪些 file slots？ | **CONFIRMED** | 44 read，45 seek，41 close。另有已实现 14 memset / 0 malloc，以及未实现 1 free / 3 memcpy / 10 strcmp（非 file） |
| **Q2** 下一真实调用最可能是哪个 slot？ | **CONFIRMED**（静态；非 LIVE 续跑） | 先 table[14] memset（已实现），然后 **table[44] `mr_read(handle, headbuf, 16)`**。这是下一个未实现 file slot |
| **Q3** open handle 可观察语义？ | **CONFIRMED** | 成功正整数；失败 0；第一有效 1；0 保留。单调 ID 包着 host fd，不是 pointer / 不是 VFD |
| **Q4** read ABI/EOF/return？ | **CONFIRMED** | 返回字节数；EOF 0；invalid -1；允许 short；requested>remaining → remaining |
| **Q5** seek ABI/return/origin？ | **CONFIRMED** | SET/CUR/END = 0/1/2；成功 0；失败 -1；pos signed；beyond EOF 不 clamp（my_seek） |
| **Q6** close ABI？ | **CONFIRMED** | 成功 0 失败 -1；本路径成功/失败都会 close（open 失败除外） |
| **Q7** 是否需要 info/length？ | **CONFIRMED** | **NOT REQUIRED on current startup path** |
| **Q8** 是否仍持有完整原始 MRP bytes？ | **CONFIRMED** | `MRPArchive.data` 与 `loadMrp` 输入同一引用 |
| **Q9** packName → original bytes alias？ | **INFERRED COMPATIBLE** | 保持 guest 可观察行为；不是源码内部相同 |
| **Q10** 其它 filename 必须继续 unsupported？ | **CONFIRMED** | 必须区分 namespace；禁止 any filename → current MRP |
| **Q11** 当前 startup 最小 file slots？ | **CONFIRMED** | **40 + 44 + 45 + 41**，仅 `packName` + `MR_FILE_RDONLY` |
| **Q12** 是否一次建立统一 RO handle backend？ | **INFERRED** | 是。40/44/45/41 共享 handle/pos；不要逐个 fake |
| **Q13** 下一阶段是否够证据实现最小 backend？ | **INFERRED** | 是（ABI + 静态 CFG + 原始 bytes）。本阶段 **不实现**。44/45/41 尚未 LIVE |

当前路径需要的是资源内容（不是 exists/rom pointer）。host C 的 `lookfor` 整数 **UNKNOWN** 于 r2（r2 是 `filelen*`）。`[sp]=0` **INFERRED** 为加载内容。

---

## 工具 / 测试

```bash
npx tsx tools/real/forensics-file-chain.ts test/fixtures/real/app.mrp
```

`test/real/file-chain-forensics.test.ts`：slot inventory、wrapper→slot、下一 slot=44、生产仍 40、无 handler 40–53、`archive.data` 同一性、packName alias 边界、read/seek spec。

Stage 5-D: NOT STARTED.
