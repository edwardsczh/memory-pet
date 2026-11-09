import { describe, expect, it } from "vitest";
import { CHARACTERS, DEFAULT_CHARACTER_ID } from "./characters";
import {
  EMOTIONS,
  ManifestError,
  allLayers,
  layerUrl,
  manifestUrl,
  parseManifest,
  resolveEmotion,
} from "./manifest";

function minimal(): Record<string, unknown> {
  return {
    version: 1,
    id: "test",
    name: "测试",
    size: { width: 200, height: 240 },
    layers: { base: ["base.svg"], front: ["hair.svg"] },
    emotions: {
      neutral: { eyes: "eyes.svg", mouth: "mouth.svg", blink: "blink.svg", talk: "talk.svg" },
      happy: { eyes: "eyes-happy.svg", mouth: "mouth-happy.svg", fx: ["blush.svg"] },
    },
    credits: [
      {
        title: "Art",
        author: "Someone",
        url: "https://example.com/art",
        license: "CC0 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        attribution: "Art by Someone (CC0)",
      },
    ],
  };
}

function withEmotions(emotions: unknown) {
  return { ...minimal(), emotions };
}

describe("parseManifest", () => {
  it("parses a minimal manifest and fills defaults", () => {
    const m = parseManifest(minimal());
    expect(m.anchor).toEqual({ x: 0.5, y: 1 });
    expect(m.emotions.neutral).toEqual({
      eyes: "eyes.svg",
      mouth: "mouth.svg",
      brows: null,
      blink: "blink.svg",
      talk: "talk.svg",
      fx: [],
    });
    expect(m.emotions.happy?.blink).toBeNull();
    expect(m.emotions.happy?.fx).toEqual(["blush.svg"]);
  });

  it("requires a neutral expression", () => {
    expect(() => parseManifest(withEmotions({ happy: { eyes: "e.svg", mouth: "m.svg" } }))).toThrow(
      /emotions.neutral is required/,
    );
  });

  it("ignores unknown emotion keys", () => {
    const m = parseManifest(
      withEmotions({
        neutral: { eyes: "e.svg", mouth: "m.svg" },
        sleepy: { eyes: "z.svg", mouth: "m.svg" },
      }),
    );
    expect(Object.keys(m.emotions)).toEqual(["neutral"]);
  });

  it.each([
    ["root", null, /root must be an object/],
    ["version", { ...minimal(), version: 2 }, /unsupported version/],
    ["id", { ...minimal(), id: "../evil" }, /invalid id/],
    ["size", { ...minimal(), size: { width: 0, height: 10 } }, /size.width/],
    ["anchor", { ...minimal(), anchor: { x: 2, y: 1 } }, /anchor.x/],
    ["base", { ...minimal(), layers: { base: [] } }, /layers.base needs/],
    ["credits", { ...minimal(), credits: [] }, /credits must list/],
    ["credit field", { ...minimal(), credits: [{ title: "x" }] }, /credits\[0\].author/],
    ["missing eyes", withEmotions({ neutral: { mouth: "m.svg" } }), /emotions.neutral.eyes/],
  ])("rejects invalid %s", (_label, raw, message) => {
    expect(() => parseManifest(raw)).toThrow(ManifestError);
    expect(() => parseManifest(raw)).toThrow(message);
  });

  it.each([
    "/etc/passwd",
    "../other/base.svg",
    "a/../../b.svg",
    "https://example.com/x.svg",
    "c:\\x.svg",
  ])("rejects layer paths outside the character directory: %s", (path) => {
    expect(() => parseManifest({ ...minimal(), layers: { base: [path] } })).toThrow(
      /relative path/,
    );
  });
});

describe("resolveEmotion", () => {
  const m = parseManifest(minimal());

  it("returns the requested expression", () => {
    expect(resolveEmotion(m, "happy").eyes).toBe("eyes-happy.svg");
  });

  it("falls back to neutral when the expression is missing", () => {
    expect(resolveEmotion(m, "angry")).toBe(m.emotions.neutral);
    expect(resolveEmotion(m, "thinking")).toBe(m.emotions.neutral);
  });
});

describe("paths", () => {
  it("builds manifest and layer URLs", () => {
    expect(manifestUrl("momo")).toBe("/avatar/momo/manifest.json");
    expect(layerUrl("/avatar/momo/manifest.json", "layers/base.svg")).toBe(
      "/avatar/momo/layers/base.svg",
    );
  });

  it("lists every distinct layer once", () => {
    expect(allLayers(parseManifest(minimal())).sort()).toEqual(
      [
        "base.svg",
        "blink.svg",
        "blush.svg",
        "eyes-happy.svg",
        "eyes.svg",
        "hair.svg",
        "mouth-happy.svg",
        "mouth.svg",
        "talk.svg",
      ].sort(),
    );
  });
});

describe("bundled characters", () => {
  const manifests = import.meta.glob<unknown>("/public/avatar/*/manifest.json", {
    eager: true,
    import: "default",
  });
  const files = new Set(Object.keys(import.meta.glob("/public/avatar/*/layers/*.svg")));

  it("includes the default character", () => {
    expect(CHARACTERS.map((c) => c.id)).toContain(DEFAULT_CHARACTER_ID);
  });

  it.each(CHARACTERS.map((c) => [c.id, c.name]))(
    "%s has a valid manifest with all layers present",
    (id, name) => {
      const href = `/public/avatar/${id}/manifest.json`;
      const m = parseManifest(manifests[href]);
      expect(m.id).toBe(id);
      expect(m.name).toBe(name);
      for (const e of EMOTIONS) expect(m.emotions[e], e).toBeDefined();
      for (const layer of allLayers(m)) expect(files.has(layerUrl(href, layer)), layer).toBe(true);
      expect(m.credits[0].license).toMatch(/^CC/);
    },
  );
});
