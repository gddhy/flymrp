"""Regenerate ARMv5TE DSP reference vectors with Python unicorn (2.1.4)."""
import json
from pathlib import Path
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_CPSR

rows = []
registers = [
    [0, 0, 0xffffffff, 0x80008000, 0],
    [0, 0, 0x80007fff, 0x7fff8000, 0x7fffffff],
    [0, 0, 0x7fff8000, 0x80007fff, 0x80000000],
    [0, 0, 0x80000001, 0x12348001, 0xffffffff],
    [0, 0, 0x12345678, 0x9abcdef0, 0x10203040],
    [0x76543210, 0xdeadbeef, 0xffffffff, 0xffffffff, 0xffffffff],
]
for kind in range(4):
    for xy in range(4):
        rn = 0 if kind == 3 or (kind == 1 and xy & 1) else 4
        word = 0xe1000080 | kind << 21 | 1 << 16 | rn << 12 | 3 << 8 | xy << 5 | 2
        for i, values in enumerate(registers):
            cpsr = [0x10, 0xf0000010, 0x08000010][i % 3]
            uc = Uc(UC_ARCH_ARM, UC_MODE_ARM)
            uc.mem_map(0x1000, 0x1000)
            uc.mem_write(0x1000, word.to_bytes(4, 'little'))
            uc.reg_write(UC_ARM_REG_CPSR, cpsr)
            for j, value in enumerate(values): uc.reg_write(UC_ARM_REG_R0 + j, value)
            uc.emu_start(0x1000, 0x1004, count=1)
            rows.append(dict(word=word, before=values, cpsr=cpsr,
                             after=[uc.reg_read(UC_ARM_REG_R0 + j) for j in range(5)],
                             afterCpsr=uc.reg_read(UC_ARM_REG_CPSR)))
p = Path(__file__).resolve().parents[2] / 'test/fixtures/cpu/arm-dsp.json'
p.write_text(json.dumps(dict(reference='Unicorn 2.1.4 ARMv5TE', cases=rows), indent=2) + '\n')
print(f'{len(rows)} reference vectors: {p}')
