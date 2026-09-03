# Stage 5-C.1 real-binary tests

These tests exercise inspection, optional trace, and the compatibility gate.

They use **synthetic** MRP/Lua only. They are **not** real-app tests.

`test/fixtures/real/app.mrp` is a user-supplied unprotected MRP. Gate on that file is **INSPECTED**, not real-app green. `runCompatibilityGate()` with no bytes is still `REAL_BINARY_BLOCKED`.

`loader-abi.test.ts` is the real-app chain: `start.mr` → `mrc_loader.ext` → `cfunction.ext` load → `arm_ext_call(6)` guest return 0, then stop at `table[130]`.

`cfunction-init.test.ts` is the isolated cfunction load: BLX → table[25] → table[14] memset zeros ER_RW.

`code6.test.ts` is forensics only (no host code-6 helper).
