#!/usr/bin/env python3
from unicorn import *
from unicorn.arm_const import *

REGS = [
    UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
    UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
    UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11,
    UC_ARM_REG_R12, UC_ARM_REG_R13, UC_ARM_REG_R14, UC_ARM_REG_R15,
]


def setup(code, pc=0x1000, thumb=False, regs=None, cpsr=0x10, maps=None):
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB if thumb else UC_MODE_ARM)
    mu.mem_map(0x1000, 0x4000)
    if maps:
        for base, sz in maps:
            try:
                mu.mem_map(base, sz)
            except UcError:
                pass
    mu.mem_write(pc, code)
    if regs is None:
        regs = [0] * 15 + [pc]
    for i, v in enumerate(regs):
        mu.reg_write(REGS[i], v)
    mu.reg_write(UC_ARM_REG_CPSR, cpsr)
    return mu


def go(mu, pc, thumb=False, count=1):
    mu.emu_start(pc | (1 if thumb else 0), pc + 0x200, count=count)


def hx(v):
    return f"0x{v & 0xffffffff:08x}"


# STM {r0, pc}
mu = setup(
    bytes.fromhex("01802de9"),
    regs=[0x11111111, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x2f00, 0, 0x1000],
)
go(mu, 0x1000)
sp = mu.reg_read(UC_ARM_REG_R13)
stack = mu.mem_read(sp, 8)
print("STM {r0,pc} sp", hx(sp), hx(int.from_bytes(stack[:4], "little")), hx(int.from_bytes(stack[4:], "little")))

# LDR unaligned
mu = setup(bytes.fromhex("001091e5"), regs=[0x1101] + [0] * 14 + [0x1000])
mu.mem_write(0x1100, bytes.fromhex("44332211"))
try:
    go(mu, 0x1000)
    print("LDR [0x1101] r1", hx(mu.reg_read(UC_ARM_REG_R1)))
except UcError as e:
    print("LDR unaligned", e)

# STR unaligned
mu = setup(bytes.fromhex("001080e5"), regs=[0x1101, 0xaabbccdd] + [0] * 13 + [0x1000])
mu.mem_write(0x1100, bytes.fromhex("00000000"))
try:
    go(mu, 0x1000)
    print("STR [0x1101] mem", mu.mem_read(0x1100, 8).hex())
except UcError as e:
    print("STR unaligned", e)

# MOV r0, pc
mu = setup(bytes.fromhex("0f00a0e1"), regs=[0] * 15 + [0x1000])
go(mu, 0x1000)
print("MOV r0,pc", hx(mu.reg_read(UC_ARM_REG_R0)))

# MOV r0, pc, LSL r1  r1=0 / 1
for amt in (0, 1):
    mu = setup(bytes.fromhex("1f00a1e1"), regs=[0, amt] + [0] * 13 + [0x1000])
    go(mu, 0x1000)
    print(f"MOV r0,pc,LSL r1={amt}", hx(mu.reg_read(UC_ARM_REG_R0)))

# ADD r0, pc, #0
mu = setup(bytes.fromhex("00008fe2"), regs=[0] * 15 + [0x1000])
go(mu, 0x1000)
print("ADD r0,pc,#0", hx(mu.reg_read(UC_ARM_REG_R0)))

# MULS leave C/V: already known. UMULL
mu = setup(bytes.fromhex("9200c1e0"), regs=[0, 0xffffffff, 0x2] + [0] * 12 + [0x1000])  # umull r0,r1,r2,r2? 
# umull r0, r1, r2, r3 = e0c12390
mu = setup(bytes.fromhex("903221e0"), regs=[0, 0, 0xffffffff, 2] + [0] * 11 + [0x1000])
# e0c1 2390 little = 90 23 c1 e0
mu = setup(bytes.fromhex("9023c1e0"), regs=[0, 0, 0xffffffff, 2] + [0] * 11 + [0x1000])
go(mu, 0x1000)
print("UMULL r0,r1,r2,r3", hx(mu.reg_read(UC_ARM_REG_R0)), hx(mu.reg_read(UC_ARM_REG_R1)))

# Thumb ADD rd, pc, #0
mu = setup(bytes.fromhex("0048"), pc=0x1000, thumb=True, regs=[0] * 15 + [0x1000], cpsr=0x30)
go(mu, 0x1000, thumb=True)
print("Thumb LDR r0,[pc,#0] r0", hx(mu.reg_read(UC_ARM_REG_R0)), "need literal")

# Thumb ADD r0, pc, #0 = 0xA000
mu = setup(bytes.fromhex("00a0"), pc=0x1000, thumb=True, regs=[0] * 15 + [0x1000], cpsr=0x30)
go(mu, 0x1000, thumb=True)
print("Thumb ADD r0,pc,#0", hx(mu.reg_read(UC_ARM_REG_R0)))

# Thumb ADD r0, pc, #4 = 0xA001
mu = setup(bytes.fromhex("01a0"), pc=0x1002, thumb=True, regs=[0] * 15 + [0x1002], cpsr=0x30)
go(mu, 0x1002, thumb=True)
print("Thumb ADD r0,pc,#4 at 1002", hx(mu.reg_read(UC_ARM_REG_R0)))

# CMP / TST carry from shifter
mu = setup(bytes.fromhex("010031e1"), regs=[0, 0x80000000] + [0] * 13 + [0x1000], cpsr=0x10)  # tst r1, r1
# tst r1, r1 = e1110001
mu = setup(bytes.fromhex("010011e1"), regs=[0, 0x80000000] + [0] * 13 + [0x1000], cpsr=0x10)
go(mu, 0x1000)
cpsr = mu.reg_read(UC_ARM_REG_CPSR)
print("TST r1,r1 0x80000000", hx(cpsr), "N", cpsr >> 31 & 1, "Z", cpsr >> 30 & 1, "C", cpsr >> 29 & 1)

# MOVS r0, r1 LSL #0 should keep C
mu = setup(bytes.fromhex("0100b0e1"), regs=[0, 0x7] + [0] * 13 + [0x1000], cpsr=0x20000010)
go(mu, 0x1000)
cpsr = mu.reg_read(UC_ARM_REG_CPSR)
print("MOVS r0,r1 LSL#0 Cwas1", hx(mu.reg_read(UC_ARM_REG_R0)), hx(cpsr), "C", cpsr >> 29 & 1, "N", cpsr >> 31 & 1)

# ROR #0 RRX C=0
mu = setup(bytes.fromhex("6100b0e1"), regs=[0, 0x3] + [0] * 13 + [0x1000], cpsr=0x10)
go(mu, 0x1000)
print("RRX C=0 r1=3", hx(mu.reg_read(UC_ARM_REG_R0)), "C", mu.reg_read(UC_ARM_REG_CPSR) >> 29 & 1)

# ADC overflow V: 0x7fffffff + 1 + 0
mu = setup(bytes.fromhex("0200b1e0"), regs=[0, 0x7fffffff, 1] + [0] * 12 + [0x1000], cpsr=0x10)
go(mu, 0x1000)
cpsr = mu.reg_read(UC_ARM_REG_CPSR)
print("ADCS 7fffffff+1 C=0", hx(mu.reg_read(UC_ARM_REG_R0)), "NZCV", cpsr >> 31 & 1, cpsr >> 30 & 1, cpsr >> 29 & 1, cpsr >> 28 & 1)

# SUBS overflow: 0x80000000 - 1
mu = setup(bytes.fromhex("010051e2"), regs=[0, 0x80000000] + [0] * 13 + [0x1000], cpsr=0x10)
go(mu, 0x1000)
cpsr = mu.reg_read(UC_ARM_REG_CPSR)
print("SUBS 80000000-1", hx(mu.reg_read(UC_ARM_REG_R0)), "NZCV", cpsr >> 31 & 1, cpsr >> 30 & 1, cpsr >> 29 & 1, cpsr >> 28 & 1)
