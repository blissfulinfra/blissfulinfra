import { describe, it, expect } from "vitest";
import { resolveProjectDir } from "../api.js";

// resolveProjectDir is the single function every `/api/v1/projects/:name/...`
// route handler uses to find the on-disk dir. The client-model CLIENT_NAME
// indirection was removed with ADR-0017's purge; tenant-aware resolution
// (registry lookup → service dir) lands with the runtime-axis work.

describe("resolveProjectDir", () => {
  it("joins workingDir and name directly", () => {
    expect(resolveProjectDir("/projects", "foo")).toBe("/projects/foo");
  });

  it("preserves absolute paths", () => {
    expect(resolveProjectDir("/var/projects", "my-app")).toBe("/var/projects/my-app");
  });
});
