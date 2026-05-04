import fs from "node:fs/promises";
import path from "node:path";
import type { InfraComponent } from "./infra-deps.js";

/**
 * In-place edit of a client's `blissful-infra.yaml` to toggle an infra flag.
 *
 * The YAML produced by `blissful-infra client create` follows a known shape
 * (see commands/client.ts), so we do a surgical regex replacement rather than
 * round-tripping through a YAML parser. This preserves any user-added
 * comments or fields untouched, and avoids pulling in a YAML library for
 * what is fundamentally a one-line toggle.
 *
 * If the flag is already at the desired value the file is not rewritten.
 * Returns whether a write actually happened.
 */
export async function setClientInfraFlag(
  clientDir: string,
  component: InfraComponent,
  enabled: boolean,
): Promise<boolean> {
  const configPath = path.join(clientDir, "blissful-infra.yaml");
  const original = await fs.readFile(configPath, "utf-8");

  const next = applyInfraFlagEdit(original, component, enabled);
  if (next === original) return false;

  await fs.writeFile(configPath, next);
  return true;
}

/** Pure transformation — extracted so it can be unit-tested without I/O. */
export function applyInfraFlagEdit(
  yaml: string,
  component: InfraComponent,
  enabled: boolean,
): string {
  // Observability sub-keys live nested under `infrastructure.observability`.
  const isObsKey = component === "prometheus" || component === "grafana"
                || component === "jaeger" || component === "loki";

  // Match an existing line at any indentation. The CLI emits 2-space indent
  // for top-level infra flags and 4-space for observability sub-keys, so the
  // generic `^(\s+)<comp>: (true|false)` works for both.
  const existing = new RegExp(`^(\\s+)${component}: (true|false)\\s*$`, "m");
  const match = yaml.match(existing);
  if (match) {
    return yaml.replace(existing, `${match[1]}${component}: ${enabled}`);
  }

  // Flag isn't currently set — insert it.
  if (isObsKey) {
    // Insert after `observability:` line. If there is no observability
    // block, fall through to top-level injection (which would be wrong, but
    // only if someone hand-edited the YAML to remove the block — emit a
    // sensible default).
    const obsBlock = /^( {2})observability:$/m;
    if (obsBlock.test(yaml)) {
      return yaml.replace(obsBlock, `$1observability:\n$1  ${component}: ${enabled}`);
    }
  }

  // Top-level infra flag insertion under the `infrastructure:` block.
  const infraBlock = /^infrastructure:$/m;
  if (infraBlock.test(yaml)) {
    return yaml.replace(infraBlock, `infrastructure:\n  ${component}: ${enabled}`);
  }

  // No infrastructure block at all — append a minimal one. Rare path.
  const trailingNl = yaml.endsWith("\n") ? "" : "\n";
  return `${yaml}${trailingNl}infrastructure:\n  ${component}: ${enabled}\n`;
}
