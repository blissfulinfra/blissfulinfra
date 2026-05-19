import { describe, it, expect } from "vitest";
import type { ClientOntology, OntologyNode } from "@blissful-infra/shared";
import { autoLayout, mergeWithDiscovered } from "../ontology.js";

const discovered = (id: string, type: OntologyNode["type"], label: string): Omit<OntologyNode, "position"> =>
  ({ id, type, label });

describe("autoLayout", () => {
  it("places services on the left and infra on the right", () => {
    const out = autoLayout([
      discovered("service:api", "service", "api"),
      discovered("infra:postgres", "postgres", "Postgres"),
    ]);
    const api = out.find(n => n.id === "service:api")!;
    const pg = out.find(n => n.id === "infra:postgres")!;
    expect(api.position.x).toBeLessThan(pg.position.x);
  });

  it("stacks nodes of the same column vertically", () => {
    const out = autoLayout([
      discovered("service:a", "service", "a"),
      discovered("service:b", "service", "b"),
    ]);
    const a = out.find(n => n.id === "service:a")!;
    const b = out.find(n => n.id === "service:b")!;
    expect(a.position.x).toBe(b.position.x);
    expect(b.position.y).toBeGreaterThan(a.position.y);
  });

  it("returns nodes with valid positions for every input", () => {
    const out = autoLayout([
      discovered("service:api", "service", "api"),
      discovered("infra:kafka", "kafka", "Kafka"),
      discovered("infra:postgres", "postgres", "Postgres"),
    ]);
    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
    }
  });
});

describe("mergeWithDiscovered", () => {
  const baseDiscovered: Omit<OntologyNode, "position">[] = [
    discovered("service:api", "service", "api"),
    discovered("infra:postgres", "postgres", "Postgres"),
  ];

  it("uses auto-layout positions when no saved graph exists", () => {
    const out = mergeWithDiscovered(null, baseDiscovered, "dev");
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toEqual([]);
    expect(out.clientName).toBe("dev");
  });

  it("preserves saved positions for nodes that still exist", () => {
    const saved: ClientOntology = {
      clientName: "dev",
      nodes: [
        { id: "service:api", type: "service", label: "api", position: { x: 999, y: 888 } },
      ],
      edges: [],
    };
    const out = mergeWithDiscovered(saved, baseDiscovered, "dev");
    const api = out.nodes.find(n => n.id === "service:api")!;
    expect(api.position).toEqual({ x: 999, y: 888 });
  });

  it("drops saved nodes that are no longer discovered", () => {
    const saved: ClientOntology = {
      clientName: "dev",
      nodes: [
        { id: "service:api", type: "service", label: "api", position: { x: 0, y: 0 } },
        { id: "service:gone", type: "service", label: "gone", position: { x: 0, y: 0 } },
      ],
      edges: [],
    };
    const out = mergeWithDiscovered(saved, baseDiscovered, "dev");
    expect(out.nodes.map(n => n.id).sort()).toEqual(["infra:postgres", "service:api"]);
  });

  it("drops edges whose endpoints no longer exist", () => {
    const saved: ClientOntology = {
      clientName: "dev",
      nodes: [],
      edges: [
        { id: "e1", source: "service:api", target: "infra:postgres", type: "database", wired: false },
        { id: "e2", source: "service:api", target: "service:ghost", type: "http", wired: false },
      ],
    };
    const out = mergeWithDiscovered(saved, baseDiscovered, "dev");
    expect(out.edges.map(e => e.id)).toEqual(["e1"]);
  });

  it("preserves edges that reference still-existing nodes", () => {
    const saved: ClientOntology = {
      clientName: "dev",
      nodes: [],
      edges: [
        { id: "e1", source: "service:api", target: "infra:postgres", type: "database", label: "main db", wired: true },
      ],
    };
    const out = mergeWithDiscovered(saved, baseDiscovered, "dev");
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].label).toBe("main db");
    expect(out.edges[0].wired).toBe(true);
  });

  it("adds new nodes that weren't in the saved graph", () => {
    const saved: ClientOntology = {
      clientName: "dev",
      nodes: [{ id: "service:api", type: "service", label: "api", position: { x: 0, y: 0 } }],
      edges: [],
    };
    const expanded = [
      ...baseDiscovered,
      discovered("infra:kafka", "kafka", "Kafka"),
    ];
    const out = mergeWithDiscovered(saved, expanded, "dev");
    expect(out.nodes.find(n => n.id === "infra:kafka")).toBeDefined();
  });
});
