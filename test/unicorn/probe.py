#!/usr/bin/env python3
"""One-off Unicorn probes for ARM edge cases Stage 3 must match."""
from unicorn import *
from unicorn.arm_const import *

REGS = [
    UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
    UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
    UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11,
    UC_ARM_REG_R12, UC_ARM_REG_R13, UC_ARM_REG_R14, UC_ARM_REG_R15,
]


def run(code: bytes, pc=0x1000, thumb=False, regs=None, cpsr=None, mem=None, count=1):
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB if thumb else UC_MODE_ARM)
    mu.mem_map(0x1000, 0x2000)
    mu.mem_write(pc, code)
    if mem:
        for addr, data in mem:
            mu.mem_write(addr, data)
    if regs:
        for i, v in enumerate(regs):
            mu.reg_write(REGS[i], v)
    else:
        for i in range(16):
            mu.reg_write(REGS[i], 0)
        mu.reg_write(UC_ARM_REG_R15, pc)
    if cpsr is not None:
        mu.reg_write(UC_ARM_REG_CPSR, cpsr)
    start = pc | (1 if thumb else 0)
    mu.emu_start(start, pc + 0x100, count=count)
    out = [mu.reg_read(r) for r in REGS]
    return out, mu.reg_read(UC_ARM_REG_CPSR), mu.mem_read(0x1000, 0x40)


def hx(v):
    return f"0x{v & 0xffffffff:08x}"


def show(title, regs, cpsr):
    print(title)
    print("  r", " ".join(hx(x) for x in regs))
    print(f"  cpsr {hx(cpsr)} N={cpsr>>31&1} Z={cpsr>>30&1} C={cpsr>>29&1} V={cpsr>>28&1} T={cpsr>>5&1}")


# ADD r0, r0, r1  (S=0) and ADDS
show("ADDS r0,r1,#1 from 0xffffffff", *run(
    bytes.fromhex("010070e2"),  # adds r0, r0, #1? wait e2 70 00 01 = SUBS?
    regs=[0xffffffff, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x10,
)[:2])

# Correct encodings little-endian:
# ADDS r0, r1, #1  = e2 91 00 01
show("ADDS r0,r1,#1 r1=0xffffffff", *run(
    bytes.fromhex("010091e2"),
    regs=[0, 0xffffffff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x10,
)[:2])

# SUBS r0, r1, #1  r1=0  -> C=0 V=0 N=1 Z=0
show("SUBS r0,r1,#1 r1=0", *run(
    bytes.fromhex("010051e2"),
    regs=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x20000010,  # C was 1
)[:2])

# ADC / SBC
show("ADCS r0,r1,r2 C=1", *run(
    bytes.fromhex("0200b1e0"),  # adcs r0, r1, r2
    regs=[0, 0xffffffff, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x20000010,
)[:2])

show("SBCS r0,r1,r2 C=0", *run(
    bytes.fromhex("0200d1e0"),
    regs=[0, 5, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x10,
)[:2])

# LSL #0 / LSR #0 / ASR #0 / ROR #0 (RRX)
# MOV r0, r1 LSL #0 = e1a00001
show("MOV r0,r1 LSL#0", *run(
    bytes.fromhex("0100a0e1"),
    regs=[0, 0x80000001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x20000010,
)[:2])

# MOVS r0, r1 LSR #0 (=LSR#32)
show("MOVS r0,r1 LSR#0", *run(
    bytes.fromhex("2100b0e1"),
    regs=[0, 0x80000001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x10,
)[:2])

show("MOVS r0,r1 ASR#0", *run(
    bytes.fromhex("4100b0e1"),
    regs=[0, 0x80000001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x10,
)[:2])

show("MOVS r0,r1 ROR#0 (RRX) C=1", *run(
    bytes.fromhex("6100b0e1"),
    regs=[0, 0x00000002, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x20000010,
)[:2])

# MULS flags
show("MULS r0,r1,r2", *run(
    bytes.fromhex("91000ce0"),  # muls r0, r1, r2? e00c0091 = mul r0,r1,r12
    regs=[0, 3, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    cpsr=0x30000010,
)[:2])

# STM pc
# stmfd sp!, {r0, pc}  at 0x1000, sp=0x1f00
regs, cpsr, _ = run(
    bytes.fromhex("01802de9"),  # push {r0, pc} = stmfd sp!, {r0,pc}
    regs=[0x11111111, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1f00, 0, 0x1000],
    cpsr=0x10,
)
mu_mem = Uc(UC_ARCH_ARM, UC_MODE_ARM)
# re-run to read stack
mu = Uc(UC_ARCH_ARM, UC_MODE_ARM)
mu.mem_map(0x1000, 0x2000)
mu.mem_write(0x1000, bytes.fromhex("01802de9"))
for i, v in enumerate([0x11111111, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1f00, 0, 0x1000]):
    mu.reg_write(REGS[i], v)
mu.reg_write(UC_ARM_REG_CPSR, 0x10)
mu.emu_start(0x1000, 0x1100, count=1)
sp = mu.reg_read(UC_ARM_REG_R13)
stack = mu.mem_read(sp, 8)
print("STM {r0,pc} sp", hx(sp), "mem", stack.hex(), "words", hx(int.from_bytes(stack[:4], "little")), hx(int.from_bytes(stack[4:], "little")))

# LDR unaligned
mu = Uc(UC_ARCH_ARM, UC_MODE_ARM)
mu.mem_map(0x1000, 0x2000)
mu.mem_write(0x1000, bytes.fromhex("001091e5"))  # ldr r1, [r0]
mu.mem_write(0x1100, bytes.fromhex("44332211"))
mu.reg_write(UC_ARM_REG_R0, 0x1101)
mu.reg_write(UC_ARM_REG_R15, 0x1000)
mu.reg_write(UC_ARM_REG_CPSR, 0x10)
try:
    mu.emu_start(0x1000, 0x1100, count=1)
    print("LDR [r0=1101] r1", hx(mu.reg_read(UC_ARM_REG_R1)))
except UcError as e:
    print("LDR unaligned error", e)

# PC as Rm LSL #0
show("MOV r0, pc", *run(
    bytes.fromhex("0f00a0e1"),
    regs=[0] * 15 + [0x1000],
    cpsr=0x10,
)[:2])

# PC as Rm with register shift
# mov r0, r15, lsl r1
show("MOV r0, pc, LSL r1 (r1=0)", *run(
    bytes.fromhex("1f00a1e1"),
    regs=[0, 0] + [0] * 13 + [0x1000],
    cpsr=0x10,
)[:2])

show("MOV r0, pc, LSL r1 (r1=1)", *run(
    bytes.fromhex("1f00a1e1"),
    regs=[0, 1] + [0] * 13 + [0x1000],
    cpsr=0x10,
)[:2])
