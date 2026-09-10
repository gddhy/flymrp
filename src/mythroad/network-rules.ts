import defaults from "../../assets/network-rules.json";
export type DownloadRoute = { host?: string; ip?: string; port?: number; method?: "GET" | "POST"; path: string; file: string };
export type NetworkRules = { hosts: string[]; ips: string[]; routes: DownloadRoute[]; packages: Record<string, string> };
export function ipv4(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.some(n => n > 255) ? null : parts.reduce((n, part) => (n * 256 + part) >>> 0, 0);
}
export function ipString(ip: number): string { return [24,16,8,0].map(shift => (ip >>> shift) & 255).join("."); }
export function hostname(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.length > 253 || host.includes("..")) throw new Error("无效域名或 IP：" + value);
  return host;
}
function resource(value: unknown): string {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("资源路径必须是 mythroad 内的相对文件路径");
  return value;
}
export function parseNetworkRules(input: unknown): NetworkRules {
  if (!input || typeof input !== "object") throw new Error("拦截配置必须是 JSON 对象");
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.hosts) || !Array.isArray(raw.ips) || !Array.isArray(raw.routes) || !raw.packages || typeof raw.packages !== "object" || Array.isArray(raw.packages)) throw new Error("配置需要 hosts、ips、routes 和 packages");
  if (raw.hosts.length + raw.ips.length + raw.routes.length > 1024 || Object.keys(raw.packages).length > 4096) throw new Error("拦截规则过多");
  const hosts = raw.hosts.map(h => { if (typeof h !== "string") throw new Error("域名必须是字符串"); return hostname(h); });
  const ips = raw.ips.map(ip => { if (typeof ip !== "string" || ipv4(ip) === null) throw new Error("无效 IPv4 地址"); return ipString(ipv4(ip)!); });
  const routes = raw.routes.map((value: unknown): DownloadRoute => {
    if (!value || typeof value !== "object") throw new Error("无效下载映射");
    const route = value as DownloadRoute;
    if ((!route.host && !route.ip) || typeof route.path !== "string" || !route.path.startsWith("/") || /[\r\n]/.test(route.path)) throw new Error("下载映射需要 host 或 ip，以及以 / 开始的 path");
    if (route.ip && (typeof route.ip !== "string" || ipv4(route.ip) === null)) throw new Error("无效映射 IP");
    if (route.host && typeof route.host !== "string") throw new Error("无效映射域名");
    if (route.port !== undefined && (!Number.isInteger(route.port) || route.port < 1 || route.port > 65535)) throw new Error("端口必须在 1–65535 之间");
    if (route.method !== undefined && !["GET", "POST"].includes(route.method)) throw new Error("映射仅支持 GET 或 POST");
    return { ...route, host: route.host ? hostname(route.host) : undefined, ip: route.ip ? ipString(ipv4(route.ip)!) : undefined, file: resource(route.file) };
  });
  const packages: Record<string, string> = {};
  for (const [id, path] of Object.entries(raw.packages)) {
    if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 0xffffffff) throw new Error("无效数据包 appid");
    packages[id] = resource(path);
  }
  return { hosts: [...new Set(hosts)], ips: [...new Set(ips)], routes, packages };
}
export const DEFAULT_NETWORK_RULES = parseNetworkRules(defaults);
