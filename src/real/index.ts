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
