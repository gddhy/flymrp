#!/usr/bin/env python3
"""Unicorn EXT ABI oracle. JSON-lines. Not bundled for browsers."""
from __future__ import annotations

import json
import sys
from unicorn import *
from unicorn.arm_const import *

REGS = [
    UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
    UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
    UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11,
    UC_ARM_REG_R12, UC_ARM_REG_R13, UC_ARM_REG_R14, UC_ARM_REG_R15,
]

TABLE = 0x00010000
BX_LR = (0xE12FFF1E).to_bytes(4, "little")


def apply_hook(mu: Uc, kind: str) -> None:
    r0 = mu.reg_read(UC_ARM_REG_R0)
    r1 = mu.reg_read(UC_ARM_REG_R1)
    r2 = mu.reg_read(UC_ARM_REG_R2)
    r3 = mu.reg_read(UC_ARM_REG_R3)
    if kind == "const":
        mu.reg_write(UC_ARM_REG_R0, 0x51)
    elif kind == "add":
        mu.reg_write(UC_ARM_REG_R0, (r0 + r1) & 0xFFFFFFFF)
    elif kind == "echo":
        mu.reg_write(UC_ARM_REG_R0, r0)
    elif kind == "arg4":
        sp = mu.reg_read(UC_ARM_REG_R13)
        val = int.from_bytes(mu.mem_read(sp, 4), "little")
        mu.reg_write(UC_ARM_REG_R0, val)
    elif kind == "write":
        mu.mem_write(r0, (0x0DDBA11).to_bytes(4, "little"))
        mu.reg_write(UC_ARM_REG_R0, 0)
    else:
        mu.reg_write(UC_ARM_REG_R0, r0)
    _ = (r2, r3)


def run_one(req: dict) -> dict:
    thumb = int(req.get("thumb", 0))
    mode = UC_MODE_THUMB if thumb else UC_MODE_ARM
    mu = Uc(UC_ARCH_ARM, mode)
    mapped = set()
    for m in req.get("maps", [{"addr": 0, "size": 0x10000}]):
        addr = int(m["addr"]) & ~0xFFF
        size = (int(m["size"]) + 0xFFF) & ~0xFFF
        key = (addr, size)
        if key in mapped:
            continue
        mu.mem_map(addr, size)
        mapped.add(key)
    for m in req.get("mem", []):
        mu.mem_write(int(m["addr"]), bytes.fromhex(m["hex"]))
    hooks = {int(h["slot"]): h["kind"] for h in req.get("table_hooks", [])}
    for slot in hooks:
        mu.mem_write(TABLE + slot * 4, BX_LR)

    def on_code(uc, address, size, user):
        if TABLE <= address < TABLE + 150 * 4 and (address & 3) == 0:
            idx = (address - TABLE) // 4
            if idx in hooks:
                apply_hook(uc, hooks[idx])

    if hooks:
        mu.hook_add(UC_HOOK_CODE, on_code, begin=TABLE, end=TABLE + 150 * 4 - 1)

    pc = int(req["pc"]) & 0xFFFFFFFF
    mu.reg_write(UC_ARM_REG_CPSR, int(req.get("cpsr", 0x10 if not thumb else 0x30)) & 0xFFFFFFFF)
    regs = req["regs"]
    for i, rr in enumerate(REGS):
        mu.reg_write(rr, int(regs[i]) & 0xFFFFFFFF)
    start = (pc | 1) if thumb else pc
    until = int(req.get("until", pc + 0x800))
    err = None
    try:
        mu.emu_start(start, until, count=int(req.get("count", 64)))
    except UcError as e:
        err = str(e)
    out_regs = [mu.reg_read(r) & 0xFFFFFFFF for r in REGS]
    cpsr = mu.reg_read(UC_ARM_REG_CPSR) & 0xFFFFFFFF
    dumps = []
    for m in req.get("dump", []):
        dumps.append({
            "addr": m["addr"],
            "hex": mu.mem_read(int(m["addr"]), int(m["len"])).hex(),
        })
    return {"regs": out_regs, "cpsr": cpsr, "error": err, "mem": dumps}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            out = run_one(req)
        except Exception as e:
            out = {"error": f"oracle:{e}", "regs": [0] * 16, "cpsr": 0, "mem": []}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
