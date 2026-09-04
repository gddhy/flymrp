export { inspectBytes, sha256hex, magicAscii, type InspectResult, type FormatClass } from "./inspect.ts";
export { loaderReadiness, anyReady, type ReadinessItem, type ReadinessStatus } from "./readiness.ts";
export {
  runCompatibilityGate,
  discoverRealBinaries,
  gateMarkdown,
  type GateOptions,
} from "./gate.ts";
export {
  renderCompatibilityReport,
  emptyBlockedReport,
  type CompatibilityReport,
} from "./report.ts";
export {
  analyzeExtImage,
  extractNamedExt,
  renderCode6Markdown,
  runCode6Forensics,
  sha256hex as sha256hexBytes,
  type Code6ForensicsReport,
} from "./code6.ts";
export {
  TESTCOM130,
  renderTestCom130Markdown,
  runTestCom130Forensics,
  type TestCom130Report,
} from "./testcom130.ts";
export {
  TESTCOM130_DEP,
  renderTestCom130DepMarkdown,
  runTestCom130DepForensics,
  type TestCom130DepReport,
} from "./testcom130dep.ts";
export {
  CODE0_CHAIN,
  renderCode0ChainMarkdown,
  runCode0ChainForensics,
  runProductionCode0Fault,
  type Code0ChainReport,
  type Code0TableHit,
} from "./code0chain.ts";
export {
  PLATEX38,
  renderPlatex38Markdown,
  runPlatex38Forensics,
  type Platex38Report,
} from "./platex38.ts";
export {
  GETTIME33,
  renderGetTime33Markdown,
  runGetTime33Forensics,
  type GetTime33Report,
} from "./gettime33.ts";
export {
  OPEN40,
  FILE_ABI_SLOTS,
  MR_OPEN_MODES,
  renderOpen40Markdown,
  runOpen40Forensics,
  type Open40Report,
} from "./open40.ts";
export {
  FILECHAIN,
  FILE_SLOT_INVENTORY,
  MINIMAL_STARTUP_FILE_SLOTS,
  renderFileChainMarkdown,
  runFileChainForensics,
  specReadCount,
  specSeek,
  type FileChainReport,
} from "./filechain.ts";
export {
  MEMCPY3,
  memcpy2Forward,
  rangesOverlap,
  renderMemcpy3Markdown,
  runMemcpy3Forensics,
  scanMrTableSlotCalls,
  type Memcpy3Report,
} from "./memcpy3.ts";
export {
  FREE1,
  firstFitReuseSameSize,
  flymrpBumpSecond,
  realLGmemSize,
  renderFree1Markdown,
  runFree1Forensics,
  type Free1Report,
} from "./free1.ts";
export {
  REAL_MRP_BASELINE,
  renderRealMrpStartupMarkdown,
  runRealMrpStartup,
  type ExecStatus,
  type RealMrpStartupReport,
} from "./startup.ts";
