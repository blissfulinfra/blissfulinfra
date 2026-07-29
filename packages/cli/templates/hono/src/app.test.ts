import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";

describe("{{PROJECT_NAME}}", () => {
  const app = createApp();

  it("reports health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "UP" });
  });

  it("greets by name", async () => {
    const res = await app.request("/api/hello?name=blissful");
    expect(await res.json()).toEqual({ greeting: "Hello, blissful" });
  });

  it("defaults the greeting", async () => {
    const res = await app.request("/api/hello");
    expect(await res.json()).toEqual({ greeting: "Hello, world" });
  });
});
