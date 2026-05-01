import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProjectDir } from "../api.js";

// resolveProjectDir is the single function every `/api/v1/projects/:name/...`
// route handler uses to find the on-disk dir. Bug history: when CLIENT_NAME is
// set, services live at <workingDir>/<CLIENT_NAME>/<name>, not <workingDir>/
// <name>. Every endpoint that bypasses this helper 404s in client mode — see
// commit history for the regression where 31 inline `path.join` calls broke
// every gatling/log/metrics endpoint after the dev-app migration.

describe("resolveProjectDir", () => {
  let originalClientName: string | undefined;

  beforeEach(() => {
    originalClientName = process.env.CLIENT_NAME;
    delete process.env.CLIENT_NAME;
  });

  afterEach(() => {
    if (originalClientName !== undefined) {
      process.env.CLIENT_NAME = originalClientName;
    } else {
      delete process.env.CLIENT_NAME;
    }
  });

  describe("flat model (CLIENT_NAME unset)", () => {
    it("joins workingDir and name directly", () => {
      expect(resolveProjectDir("/projects", "foo")).toBe("/projects/foo");
    });

    it("preserves absolute paths", () => {
      expect(resolveProjectDir("/var/projects", "my-app")).toBe("/var/projects/my-app");
    });
  });

  describe("client model (CLIENT_NAME set)", () => {
    it("inserts CLIENT_NAME between workingDir and name", () => {
      process.env.CLIENT_NAME = "dev";
      expect(resolveProjectDir("/projects", "app")).toBe("/projects/dev/app");
    });

    it("works with multi-segment client names", () => {
      process.env.CLIENT_NAME = "acme-corp";
      expect(resolveProjectDir("/projects", "payment-service")).toBe(
        "/projects/acme-corp/payment-service",
      );
    });

    it("empty CLIENT_NAME falls back to flat model", () => {
      process.env.CLIENT_NAME = "";
      expect(resolveProjectDir("/projects", "foo")).toBe("/projects/foo");
    });
  });
});
