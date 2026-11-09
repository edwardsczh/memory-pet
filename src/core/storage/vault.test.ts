import { describe, expect, it } from "vitest";
import { collection, createLocalVault, isValidName, type KeyValueStorage } from "./vault";

function fakeStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

describe("local vault", () => {
  it("round-trips JSON values by copy", async () => {
    const vault = createLocalVault();
    const value = { name: "小明", tags: ["a"] };
    await vault.put("characters", "c1", value);
    value.tags.push("mutated");
    expect(await vault.get("characters", "c1")).toEqual({ name: "小明", tags: ["a"] });
    expect(await vault.get("characters", "missing")).toBeNull();
  });

  it("lists, deletes and wipes per namespace", async () => {
    const storage = fakeStorage();
    storage.setItem("unrelated", "keep");
    const vault = createLocalVault(storage);
    await vault.put("notes", "b", 1);
    await vault.put("notes", "a", 2);
    await vault.put("other", "x", 3);
    expect(await vault.list("notes")).toEqual(["a", "b"]);

    await vault.delete("notes", "a");
    expect(await vault.list("notes")).toEqual(["b"]);

    await vault.wipe("notes");
    expect(await vault.list("notes")).toEqual([]);
    expect(await vault.get("other", "x")).toBe(3);

    await vault.wipe();
    expect(await vault.list("other")).toEqual([]);
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("enforces the same names as the Rust vault", async () => {
    const vault = createLocalVault();
    expect(isValidName("a.v2_x-1")).toBe(true);
    for (const bad of ["", ".hidden", "a/b", "名字", "x".repeat(129)]) {
      expect(isValidName(bad)).toBe(false);
    }
    await expect(vault.put("a/b", "k", 1)).rejects.toThrow("名称不合法");
    await expect(vault.get("secrets", "llm-api-key")).rejects.toThrow("内部");
    expect(await vault.status()).toEqual({ protected: false });
  });

  it("offers typed collections", async () => {
    const vault = createLocalVault();
    const notes = collection<{ text: string }>("notes", vault);
    await notes.put("n1", { text: "hi" });
    expect((await notes.get("n1"))?.text).toBe("hi");
    expect(await notes.list()).toEqual(["n1"]);
    await notes.clear();
    expect(await notes.list()).toEqual([]);
  });
});
