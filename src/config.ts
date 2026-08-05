import { readFileSync } from "node:fs";

export type Protocol = "tcp" | "udp";

export interface ServerConfig {
  readonly label: string;
  readonly unit: string;
  readonly port: number;
  readonly protocol: Protocol;
  readonly address: string;
  readonly startupMs: number;
  readonly roleId?: string;
}

export type Servers = ReadonlyMap<string, ServerConfig>;

const DEFAULT_STARTUP_MS = 120_000;
// Discord interaction tokens expire after 15 minutes; the final editReply after
// waitFor() must land before that, so cap the configurable wait at 14 minutes.
const MAX_STARTUP_MS = 840_000;

class ConfigError extends Error {}

function bad(where: string, msg: string): never {
  throw new ConfigError(`servers.json: ${where} ${msg}`);
}

function requireString(
  o: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const v = o[key];
  if (typeof v !== "string" || v.trim() === "")
    bad(`${where}.${key}`, "must be a non-empty string");
  return v;
}

function parseServer(key: string, raw: unknown): ServerConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    bad(key, "must be an object");
  }
  const o = raw as Record<string, unknown>;

  const port = o["port"];
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    bad(`${key}.port`, "must be an integer between 1 and 65535");
  }

  const protocol = o["protocol"];
  if (protocol !== "tcp" && protocol !== "udp") {
    bad(`${key}.protocol`, "must be 'tcp' or 'udp'");
  }

  const startupRaw = o["startupMs"];
  if (
    startupRaw !== undefined &&
    (typeof startupRaw !== "number" ||
      startupRaw <= 0 ||
      startupRaw > MAX_STARTUP_MS)
  ) {
    bad(
      `${key}.startupMs`,
      `must be a positive number of ms, at most ${MAX_STARTUP_MS}`,
    );
  }

  const roleId = o["roleId"];
  if (roleId !== undefined && typeof roleId !== "string") {
    bad(`${key}.roleId`, "must be a string if present");
  }

  return {
    label: requireString(o, "label", key),
    unit: requireString(o, "unit", key),
    address: requireString(o, "address", key),
    port,
    protocol,
    startupMs: typeof startupRaw === "number" ? startupRaw : DEFAULT_STARTUP_MS,
    ...(typeof roleId === "string" ? { roleId } : {}),
  };
}

export function loadServers(path: URL): Servers {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(
      `Could not read ${path.pathname}: ${(err as Error).message}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    bad("root", "must be an object keyed by server name");
  }

  const map = new Map<string, ServerConfig>();
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z0-9-]+$/.test(key))
      bad(key, "key must be lowercase letters, digits and hyphens");
    map.set(key, parseServer(key, raw));
  }
  if (map.size === 0) bad("root", "defines no servers");
  if (map.size > 25)
    bad("root", "Discord allows at most 25 choices per option");

  return map;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "")
    throw new ConfigError(`Missing environment variable ${name}`);
  return v;
}
