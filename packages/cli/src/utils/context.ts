import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getBlissfulHome } from "./tenant-registry.js";

/**
 * Current "working set" — like kubectl context or `sdk use`. Stored at
 * ~/.blissful-infra/context.json so it persists across CLI invocations.
 * Tests get a fresh one per test via mkdtemp BLISSFUL_HOME.
 */

const ContextSchema = z.object({
  tenant: z.string().optional(),
  project: z.string().optional(),
});

export type Context = z.infer<typeof ContextSchema>;

function contextPath(): string {
  return path.join(getBlissfulHome(), "context.json");
}

export async function readContext(): Promise<Context> {
  try {
    const raw = await fs.readFile(contextPath(), "utf-8");
    return ContextSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function writeContext(ctx: Context): Promise<void> {
  await fs.mkdir(getBlissfulHome(), { recursive: true });
  await fs.writeFile(contextPath(), JSON.stringify(ContextSchema.parse(ctx), null, 2));
}

export async function clearContext(): Promise<void> {
  try {
    await fs.unlink(contextPath());
  } catch { /* not there, fine */ }
}

/**
 * Resolve positional args + context + env into a fully-qualified target.
 *
 * `required` declares the path the command needs, e.g. ["tenant"] for
 * `tenant status`, ["tenant", "project"] for `project status`, ["tenant",
 * "project", "service"] for `service add`.
 *
 * Positional args fill FROM THE RIGHT — the rightmost arg is always the
 * "leaf" (most specific), with missing prefixes pulled from env then context.
 * This matches the natural typing pattern: you almost always know the leaf;
 * you rarely want to retype the path above it.
 *
 *   resolve(["orders-api"], ["tenant","project","service"])
 *     → { tenant: <ctx>, project: <ctx>, service: "orders-api" }
 *   resolve(["ecommerce","orders-api"], ["tenant","project","service"])
 *     → { tenant: <ctx>, project: "ecommerce", service: "orders-api" }
 *   resolve(["acme","ecommerce","orders-api"], ["tenant","project","service"])
 *     → { tenant: "acme", project: "ecommerce", service: "orders-api" }
 */
export type ContextKey = "tenant" | "project" | "service";

export interface ResolvedArgs {
  tenant?: string;
  project?: string;
  service?: string;
}

export async function resolveArgs(
  positional: (string | undefined)[],
  required: ContextKey[],
): Promise<ResolvedArgs> {
  const provided = positional.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (provided.length > required.length) {
    throw new Error(
      `Too many arguments: expected at most ${required.length} (${required.join(" ")}), got ${provided.length}.`,
    );
  }

  const result: ResolvedArgs = {};

  // Fill from the right: last positional becomes the leaf key.
  const startIdx = required.length - provided.length;
  for (let i = 0; i < provided.length; i++) {
    result[required[startIdx + i]] = provided[i];
  }

  // Fill remaining from env then context.
  const ctx = await readContext();
  for (const key of required) {
    if (result[key]) continue;
    const envName = `BLISSFUL_${key.toUpperCase()}`;
    const envVal = process.env[envName];
    if (envVal) {
      result[key] = envVal;
    } else if (ctx[key as keyof Context]) {
      result[key] = ctx[key as keyof Context];
    }
  }

  // Bail with a clear message if anything is still missing.
  const missing = required.filter(k => !result[k]);
  if (missing.length > 0) {
    const hint = missing.length === 1 && missing[0] === "tenant"
      ? "blissful-infra use <tenant>"
      : `blissful-infra use ${missing.join("/")}`;
    throw new ResolveError(
      `Missing ${missing.join(", ")}. Pass explicitly, set BLISSFUL_${missing[0].toUpperCase()}, or run:\n  ${hint}`,
    );
  }

  return result;
}

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}

/**
 * Convenience for Commander action handlers: resolve args, or exit(1) with a
 * clean message. Avoids stack traces leaking through to users.
 */
export async function resolveOrExit(
  positional: (string | undefined)[],
  required: ContextKey[],
): Promise<ResolvedArgs> {
  try {
    return await resolveArgs(positional, required);
  } catch (err) {
    if (err instanceof ResolveError) {
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** Parse a target string like "acme", "acme/ecommerce" into context fields. */
export function parseTarget(target: string): Context {
  const parts = target.split("/").filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length > 2) {
    throw new Error(`Invalid target '${target}'. Expected <tenant> or <tenant>/<project>.`);
  }
  const ctx: Context = { tenant: parts[0] };
  if (parts.length === 2) ctx.project = parts[1];
  return ctx;
}
