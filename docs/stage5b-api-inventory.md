# Stage 5-B API Inventory

扫描范围（rxgj，不以记忆为准）：

* `src/mythroad/mythroad.c`（FULL，`MR_VERSION=1968`）
* `src/mythroad/mythroad_mini.c`（MINI，`MR_VERSION=2011`，本阶段不作为 Lua 主路径）
* `src/mythroad/include/mythroad.h`
* `src/mythroad/include/mrporting.h`
* `src/mythroad/include/mr.h`
* `src/mythroad/src/lib/mr_iolib_target.c`
* `src/mythroad/src/lib/mr_baselib.c`
* `src/mythroad/unused/start.mr.lua`（**源码样例，不是 binary start.mr**）

仓库内 **没有** `*.mr` / `*.mrp` binary。`real start.mr binary unavailable`。

分类：

| 类 | 含义 | Stage 5-B |
|---|---|---|
| A | 典型 `start.mr` 启动/生命周期必需 | 实现 |
| B | fixture / 资源 / 系统信息必需 | 必要项实现 |
| C | graphics | 仅 Null backend + 已确认 draw ABI |
| D | audio | 不实现（记录） |
| E | network | 不实现（记录） |
| F | optional / 未确认完整 ABI 的其余 API | 不实现 |

`called by start.mr?` 以 `unused/start.mr.lua` + `mr_start_dsm` / `mr_event` / `mr_timer` 控制流为准，**不**把该 lua 文件当成可执行 chunk。

---

## 生命周期（非 Lua 名，但决定 step 模型）

### `mr_start_dsm` / `_mr_intra_start`

| 字段 | 值 |
|---|---|
| name | `mr_start_dsm(filename, ext, entry)` |
| source | `mythroad.c:4038` / `:3740` |
| arguments | pack 路径；`ext` 默认 `"start.mr"`；`entry` 默认 `"_dsm"` |
| return values | `MR_SUCCESS=0` / `MR_FAILED=-1` |
| side effects | `mrp_open_*`；注册 native；`_mr_entry` / `_mr_param`；`dofile(ext)`；若存在 `dealtimer` 且 timer IDLE 则 `MR_TIME_START(100)` |
| state ownership | `mr_state=RUN`；VM / pack / timer / screen |
| called by start.mr? | 否（宿主启动它） |
| requires EXT? | 否 |
| class | A |

控制流 **不是** `while true`。顶层 `start.mr` 跑完即返回；之后由宿主 `mr_event` / `mr_timer` 回调 `dealevent` / `dealtimer` / `suspend` / `resume`。

### `mr_event`

| 字段 | 值 |
|---|---|
| name | `mr_event(type, param1, param2)` |
| source | `mythroad.c:4266` |
| arguments | `int16 type`, `int32 param1`, `int32 param2` |
| return values | `MR_SUCCESS` 已处理；`MR_IGNORE` 未处理 |
| side effects | 优先 `native_event_function`；否则 `dealevent(type,p1,p2)`；无 Lua hook 才 `arm_ext_call(1, event)` |
| state ownership | 仅 `RUN`，或 `PAUSE && mr_timer_run_without_pause` |
| called by start.mr? | 否（宿主） |
| requires EXT? | 仅 fallback |
| class | A |

### `mr_timer`

| 字段 | 值 |
|---|---|
| name | `mr_timer()` |
| source | `mythroad.c:4347` |
| arguments | 无 |
| return values | `MR_SUCCESS` / `MR_IGNORE` |
| side effects | 先把 `mr_timer_state=IDLE`（**one-shot**）；native timer；可选 EXT code 2；再 `pcall(global[mr_timer_p])` |
| state ownership | 平台只有 **一个** timer |
| class | A |

重复定时：callback 内再次 `TimerStart`，不是硬件自动 repeat。

---

## A — start.mr 必需

### `_strCom` / `TestCom1`

| 字段 | 值 |
|---|---|
| name | `_strCom` / `TestCom1` |
| source | `mythroad.c:3731` → `_mr_TestCom1` `:3419` |
| arguments | `(code: number, str: string [, extra])`；`str` 必选（`mr_L_checklstring`） |
| return values | 依 code |
| state ownership | Mythroad（pack / EXT / exception / ram file） |
| called by start.mr? | 是 |
| requires EXT? | 800/801/802 是 |
| class | A（已确认子集） |

| code | args | returns | side effects | class |
|---|---|---|---|---|
| 601 | name | string **或 nil**，1 值 | `_mr_readFile(..., lookfor=0)` | A |
| 602 | name | nil 或不 `MR_SUCCESS=0`，1 值 | lookfor=1 存在性 | B |
| 800 | bytes, optint(3)=load code | 1 number（r0 或 status） | `arm_ext_load`，替换 `native_ext` | A |
| 801 | bytes, tonumber(3)=call code | output string + ret，**2 值** | `arm_ext_call` | A |
| 802 | 同 800 | 同 800 | 同 800 | A |
| 2/3/4/5/6 | ram/old pack/param/exception | 默认 push number | 生命周期登记 | F（本阶段不实现，避免猜 host 指针） |
| 300/500/501/502/600/603/700/701/900 | 压缩/MD5/编解码/m0/SIM/sms/platEx | 各异 | 非 start 必需 | F |

801 常见 code（`unused/start.mr.lua` + `mythroad_mini.c`）：`0` init，`1` event，`2` timer，`4` suspend，`5` resume，`6` 传 vmver。

错误：缺 string → Lua arg error（本实现 `NativeAbiError`）；801 无 EXT → 不 return 0。

### `_com` / `TestCom` / `MRF_TestCom`

| 字段 | 值 |
|---|---|
| name | `_com` / `TestCom` |
| source | `mythroad.c:3290` → `_mr_TestCom` `:3074` |
| arguments | `(input0, input1)` 皆 tonumber，缺省 0 |
| return values | 1 number（`ret`，默认 0） |
| called by start.mr? | 是（3629/2913，400 sleep，403 gc） |
| class | A（已确认 code） |

| input0 | input1 | ret / effect | class |
|---|---|---|---|
| 1 | — | `mr_getTime()` | A |
| 3629 | 2913 | `bi \|= MR_FLAGS_BI` | A |
| 400 | ms | `mr_sleep`（浏览器 **禁止阻塞**；记录请求） | A |
| 403 | n | `mrp_setgcthreshold` | A |
| 100/101/102 | — | mem min/top/left | B |
| 401/406 | w/h | 改 `MR_SCREEN_MAX_W` / `MR_SCREEN_H` 并返回旧值 | B |
| 2–6 | fn ptr | native event/timer/stop/pause/resume | F（C 函数指针） |
| 200–307, 402, 404–408, 500–504, 3921, 3251 | 各异 | shake/sound/sms/socket/screen buf | D/E/F |

### `GetSysInfo` / `_mr_GetSysInfo`

| 字段 | 值 |
|---|---|
| name | `GetSysInfo`（亦 `sys.getInfo`） |
| source | `mythroad.c:2808` |
| arguments | opt font，默认 `MR_FONT_MEDIUM=1` |
| return values | 1 table |
| fields | `vmver=1968`；`scrw`/`scrh`（及兼容 `ScreenW`/`ScreenH`）；`chw`/`chh`（U+70B9）；`ascw`/`asch`（U+0032）；`packname`/`PackName`；`hsman`/`hstype`/`IMEI`/`IMSI`/`hsver` |
| font（gb16 MEDIUM） | ASCII w=8 h=16；汉字 w=16 h=16（`dsm.c` `EN_CHAR_W_16`/`CN_CHAR_W_16`） |
| called by start.mr? | 是 |
| requires graphics? | 否（字宽来自 DeviceProfile，不读 DOM） |
| class | A |

### Timer

| name | source | arguments | returns | notes | class |
|---|---|---|---|---|---|
| `TimerStart` / `_timerStart` | `mythroad.c:1762` | `#1` 忽略；`#2` uint16 ms；`#3` **callback 名字字符串** | 0 | 非 RUN 则 no-op；`mr_timer_p=name`；`MR_TIME_START` | A |
| `TimerStop` / `_timerStop` | `:1775` | `#1` 忽略 | 0 | `MR_TIME_STOP` → IDLE | A |

平台 timer 状态：`IDLE=0` `RUNNING=1` `SUSPENDED=2` `ERROR=3`。

### Draw / flush（A 用到的 C 子集）

| name | source | arguments | returns | class |
|---|---|---|---|---|
| `_clearScr` / `ClearScreen` | `:2537` | r,g,b | 0 | A/C |
| `_drawRect` / `DrawRect` | `:1900` | x,y,w,h,r,g,b | 0 | A/C |
| `_drawText` / `DrawText` | `:1783` | text,x,y,r,g,b [,unicode=false] [,font=MEDIUM] | `_DrawText` 的 C int（通常 0 **个** Lua 值） | A/C |
| `_dispUp` | `:1751` | x,y,w,h [,bitmapIndex=BITMAPMAX] | 0 | A/C |
| `_dispUpEx` / `DispUpEx` | `:1740` | x,y,w,h；仅 `RUN` 时 flush | 0 | B/C |
| `EffSetCon` / `_effSetCon` | `:2545` | x,y,w,h,perr,perg,perb | 0 | A/C |
| `_drawLine` | `:1924` | x1,y1,x2,y2,r,g,b | 0 | B/C |
| `_drawPoint` | `:1912` | x,y,r,g,b | 0 | B/C |

Stub 必须记 `DrawCommand`，禁止 `return 0` 当成功且无观察。

### `Exit` / `_exit`

| 字段 | 值 |
|---|---|
| source | `mythroad.c:2702` |
| arguments | 无 |
| return values | 若无 old-app：`mrp_error("Exiting...")`（**Lua error**） |
| side effects | `mr_state=STOP`；`mr_exit()` |
| class | A |

### 全局 / 回调名

| name | 谁写 | 谁读 | class |
|---|---|---|---|
| `_mr_entry` | `_mr_intra_start` | 应用 | A |
| `_mr_param` | 同上 | `start.mr.lua` | A |
| `dealevent` | `start.mr` | `mr_event` / `mr_stop`（`MR_EXIT_EVENT=8`） | A |
| `dealtimer` | `start.mr` | `mr_timer` via `mr_timer_p` | A |
| `suspend` / `resume` | `start.mr` | `mr_pauseApp` / `mr_resumeApp` | A |

### 基库（start.mr.lua 用到）

| name | source | ABI | class |
|---|---|---|---|
| `_t` | `mr_baselib.c:212` | 1 any → `"nil"/"bool"/"obj"/"num"/"str"/"tab"/"func"/"obj"/"co"` | A |
| `_gc` | `:201` | optint threshold，return 0 | A |
| `next` / `_next` | 已有 | table next | A |

`string.pack` / `string.subV`：string lib，完整实现属 F。fixture 可用 native 打包或手写 bytecode 避免依赖。

---

## B — fixture / 资源 / 系统

### VFS / `file`

| name | source | arguments | returns | class |
|---|---|---|---|---|
| `file.open` | `mr_iolib_target.c:140` | name, mode=`MR_FILE_RDONLY=1` | userdata **或** nil,err,errno | B |
| `file.close` | `:109` | handle | bool 或 nil,err,errno | B |
| `file.state` | `:65` | handle | 0 nil / 2 closed / 1 open | B |
| `file.readAll` | `:184` | name | 1 string 或 0 | B |
| `f:read` | `:272` | handle, nbytes... | strings / nil | B |
| `f:seek` | `:300` | handle, whence=`MR_SEEK_SET=0`, offset | **push 的是传入 offset**（不是 ftell） | B |
| `f:write` | `:296` | handle, strings... | bool 或 err | B |
| `sys.getFileLen` / `getfilelen` | `:369` | name | `mr_getLen` | B |
| `sys.getFileInfo` | `:363` | name | `mr_info`；文件=`MR_IS_FILE=1` | B |
| `sys.getuptime` | `:348` | — | `mr_getTime()` | B |

本实现：无 userdata/`FILEHANDLE` metatable（GETTABLE 尚不走 TM_INDEX）。`file.open` 返回 **带方法的 table**（已知兼容差异）。底层 FD 用 typed 槽，不用 `Map<number,object>` 做热路径。

文件 mode：`RDONLY=1` `WRONLY=2` `RDWR=4` `CREATE=8` `RECREATE=16`。

### `GetDatetime` / `sys.datetime`

| 字段 | 值 |
|---|---|
| source | `mythroad.c:2859` |
| returns | 成功：1 table `year/mon/day/hour/min/sec`；失败：0 |
| class | B |

### 算术辅助

| name | source | ABI | class |
|---|---|---|---|
| `_rand` / `GetRand` | `:2556` | `mr_rand() % n`，1 number | B |
| `_mod` | `:2565` | `n % m` | B |
| `_and` `_or` `_xor` | `:2575+` | 位运算，1 number | B |
| `_not` | `:2595` | **逻辑** `!n`（不是 `~`） | B |

### `_loadPack`

| 字段 | 值 |
|---|---|
| source | `:2882` | 换当前 pack 名；鉴权路径依赖 `MR_AUTHORIZATION` + `bi` |
| class | F（换包牵涉第二 MRP，本阶段不实现） |

### `_runFile` / `RunFile`

| 字段 | 值 |
|---|---|
| source | `:2968` | 设 pack/start/param 后 **RESTART + 100ms timer** |
| class | F（完整重启链留后） |

---

## C / D / E / F 未实现清单（摘）

**C 其余：** `_drawTextEx`、`_textWidth`、Bitmap\*、Sprite\*、Tile\*、`_bmp*` — 未做像素/资源解码。

**D：** `BgMusic*`、`Sound*`、`_com(300)` soundOn。

**E：** `_initNet` `_closeNet` `_com(402)` socket、`SendSms` `ConnectWAP` `GetNetworkID` `Call`。

**F：** `_plat` `_platEx`、完整 `_strCom` 2–6/300/500…、GUI `gui.*`、SaveTable/LoadTable、c2u、mathlib。

---

## 按键 / 事件码（`mrporting.h`）

事件 type：

```
MR_KEY_PRESS=0  MR_KEY_RELEASE=1  MR_MOUSE_DOWN=2  MR_MOUSE_UP=3
MR_MENU_SELECT=4  MR_MENU_RETURN=5  MR_DIALOG_EVENT=6
MR_SMS_INDICATION=7  MR_EXIT_EVENT=8  MR_SMS_RESULT=9
MR_LOCALUI_EVENT=10  MR_OSD_EVENT=11  MR_MOUSE_MOVE=12
MR_ERROR_EVENT=13  …  MR_MOTION_EVENT
```

按键 param1（从 0）：

```
0–9 数字  STAR=10  POUND=11
UP=12 DOWN=13 LEFT=14 RIGHT=15
POWER=16 SOFTLEFT=17 SOFTRIGHT=18 SEND=19 SELECT=20
VOLUME_UP=21 VOLUME_DOWN=22 CLEAR=23 A=24 B=25 CAPTURE=26 NONE=27
```

fixture 别名（枚举值本身已确认）：`FIRE → SELECT(20)`，`BACK → SOFTRIGHT(18)`。

---

## 本阶段实现集合

**A：** `_strCom` 601/800/801/802；`_com` 1/400/403/3629；`GetSysInfo`；TimerStart/Stop；clear/rect/text/dispUp/EffSetCon；Exit；`_t` `_gc`；`_mr_entry` `_mr_param`；event/timer/suspend/resume dispatch。

**B：** `_strCom(602)`；file open/read/seek/write/close/readAll/state；sys getuptime/getFileLen/getFileInfo/datetime；GetDatetime；`_rand/_mod/_and/_or/_xor/_not`；`_drawLine/_drawPoint/_dispUpEx`；`_com` 100–102/401/406。

未确认则未列进实现。
