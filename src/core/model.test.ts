import { describe, expect, it } from "vitest";
import type { PetReply } from "./model";

describe("model", () => {
  it("PetReply shape", () => {
    const r: PetReply = { messages: ["嗯呢"], emotion: "happy" };
    expect(r.messages).toHaveLength(1);
  });
});
