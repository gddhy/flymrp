#!/usr/bin/env python3
"""Unicorn correctness oracle. JSON-lines on stdin/stdout. Not bundled for browsers."""
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


def run_one(req: dict) -> dict:
    thumb = int(req.get("thumb", 0))
    mode = UC_MODE_THUMB if thumb else UC_MODE_ARM
    mu = Uc(UC_ARCH_ARM, mode)
    mu.mem_map(0, 0x10000)
    pc = int(req["pc"]) & 0xFFFFFFFF
    code = bytes.fromhex(req["code"])
    mu.mem_write(pc, code)
    for m in req.get("mem", []):
        mu.mem_write(int(m["addr"]), bytes.fromhex(m["hex"]))
    mu.reg_write(UC_ARM_REG_CPSR, int(req["cpsr"]) & 0xFFFFFFFF)
    regs = req["regs"]
    for i, rr in enumerate(REGS):
        mu.reg_write(rr, int(regs[i]) & 0xFFFFFFFF)
    start = (pc | 1) if thumb else pc
    err = None
    try:
        mu.emu_start(start, pc + 0x800, count=int(req.get("count", 1)))
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
