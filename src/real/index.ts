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
  REAL_MRP_BASELINE,
  renderRealMrpStartupMarkdown,
  runRealMrpStartup,
  type ExecStatus,
  type RealMrpStartupReport,
} from "./startup.ts";
