import { describe, it, expect } from "vitest";
import { resolveMcpApiBase } from "../mcp.js";

describe("resolveMcpApiBase", () => {
  it("returns the host dashboard URL when no flags are passed", () => {
    expect(resolveMcpApiBase({})).toBe("http://localhost:3002");
  });

  it("honors --api when explicitly passed", () => {
    expect(resolveMcpApiBase({ api: "http://localhost:9999" })).toBe("http://localhost:9999");
  });
});
