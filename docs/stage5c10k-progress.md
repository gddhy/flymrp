# Stage 5-C.10K：Current-Pack Read-Only File Backend + Real MRP Re-run

状态：**COMPLETE**（实现 table[40]/[44]/[45]/[41] 最小 current-pack 只读 alias）。**未实现** table[1] / [3] / [10] 及其它非-file slot。**Stage 5-D NOT STARTED。**

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table100  PASS / DATA SLOT
table40   PASS / REAL_EXECUTED
table44   PASS / REAL_EXECUTED
table45   PASS / REAL_EXECUTED
table41   NOT REACHED
table3    BLOCKED / LIVE REACHED

first production blocker:
  table[3]

production mr_table:
  25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40, 14, 44, 0, 45, 44, 0, 3
```

Only a deterministic read-only virtual file alias for the currently loaded MRP container is implemented.

Other filenames and write modes remain unsupported.

---

## Q1–Q19

| Q | 答案 |
|---|---|
| **Q1** 是否建立统一 read-only handle backend？ | **是。** `CurrentPackFileBackend`（`src/mythroad/pack-file.ts`）：`Map<id,{bytes,pos}>` + `nextHandle`。挂在 `MrTableBridge.files` |
| **Q2** table40 是否只支持 packName + RDONLY？ | **是。** `filename === runtime.packName` 且 `mode === MR_FILE_RDONLY` (1)。其它 filename / mode / 空串 → `UnknownAbiError`（不是 guest open-failure 0） |
| **Q3** handle 是否从 1 deterministic 分配？ | **是。** 每个 backend 从 1 单调递增。0 保留。不复用已 close 的 id。不使用 Date / host fd / 全局计数 |
| **Q4** table44 是否真实读取 archive.data raw bytes？ | **是。** `handle.bytes` 是 `MRPArchive.data` 同一引用。禁止 `getResource` / VFS member / Node fs / IndexedDB |
| **Q5** EOF / short read / invalid handle 是否符合 ABI？ | **是。** requested 0→0；short read 返回 remaining；EOF→0；invalid→`-1` / guest `0xffffffff`。unmapped dest → `MemoryFault`（不改成 -1） |
| **Q6** table45 的 SET/CUR/END / beyond EOF 是否符合 ABI？ | **是。** SET=0 CUR=1 END=2。beyond EOF 成功、不 clamp。负位置 → `-1` 且 cursor 不变 |
| **Q7** table41 是否正确失效 handle？ | **是（单元测试）。** 成功 0；invalid / double close → `-1`。本阶段真实 app **未调用** close |
| **Q8** 真实 app 是否 REAL_EXECUTED table40？ | **是。** `mr_open("gssjxz.mrp", 1)` → handle **1** |
| **Q9** 是否 LIVE 到 table44？ | **是。** 两次：16 字节 header + 5496 字节 directory |
| **Q10** 第一批 16-byte header 是否与 archive.data 一致？ | **是。** dest 与 `archive.data[0:16]` 逐字节相同（`MRPG` + FileStart 5728 + FileLen 382778 + ListStart 240） |
| **Q11** 是否 LIVE 到 table45？ | **是。** `seek(224, CUR)`：pos 16→240（ListStart）。与 header `ListStart-16` 一致 |
| **Q12** 是否 LIVE 到 table41？ | **否。** 目录循环在 memcpy 处停下，尚未 close |
| **Q13** guest 是否开始真实解析 MRP directory？ | **是。** index read 5496 bytes 与 `archive.data[240:5736]` 一致，随后 BLX table[3] memcpy（r2=4） |
| **Q14** 新 first production blocker 是什么？ | **table[3]** `UNKNOWN_REQUIRED_SLOT = 3`（memcpy）。未实现 |
| **Q15** 新 production mr_table sequence 是什么？ | `25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40, 14, 44, 0, 45, 44, 0, 3` |
| **Q16** 是否实现任何非-file slot？ | **否。** 未实现 table[1]/[3]/[10] 或其它新 slot |
| **Q17** 是否访问 host filesystem / IndexedDB？ | **否** |
| **Q18** 是否添加 forensic bypass？ | **否。** 无 cbRet unknown slots |
| **Q19** 5 次启动是否 deterministic？ | **是。** handle ids / read·seek positions / P / helper / ER_RW / ARM 332 / Lua 71 全部相同 |

C.10J 静态期望 vs C.10K LIVE：**一致**，无需停下来 forensic。

---

## LIVE file 现场

```text
open("gssjxz.mrp", MR_FILE_RDONLY=1) → handle 1, pos 0
memset(headbuf, 0, 16)
read(1, headbuf, 16) → 16; bytes == archive.data[0:16]
malloc(index)
seek(1, 224, CUR) → 0; pos 16 → 240
read(1, indexbuf, 5496) → 5496; bytes == archive.data[240:5736]; pos 5736
malloc(name scratch)
memcpy(...)                         STOP table[3]
```

`vfs.exists("gssjxz.mrp")` 仍为 false：那是包内目录，不含容器自身。guest 读的是容器字节流。

---

## Handle / archive lifetime

```text
new MythroadRuntime     → 干净 backend（bindExt 时创建）
bindExt                 → 新 MrTableBridge / 新 handle map
loadMrp                 → files.reset()；旧 handle 不能指向新 archive
applyRestart            → mrTable=null
本阶段真实 startup      → 一次 loadMrp + 一次 bindExt；同时只开 handle 1
```

reload 若发生在已 bind 的 runtime 上：reset 使旧 fd 变为 invalid（-1），下一次 open 从 1 重新分配并绑定**新** `archive.data`。

---

## 明确不是

```text
filesystem supported
mr_open fully supported
file API complete
persistent storage supported
write mode / save file
any filename → current archive
POSIX O_RDONLY=0
host fd / RB tree / EXT VFD
```

---

## 测试

```bash
npm test
npx tsc --noEmit
```

新增 `test/mythroad/pack-file.test.ts`。更新 `test/real/real-mrp-startup.test.ts`。

**Stage 5-D：NOT STARTED。**
