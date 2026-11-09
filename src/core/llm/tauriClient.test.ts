import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTauriLlmClient } from "./tauriClient";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage: (msg: unknown) => void = () => {};
  },
}));

type FakeChannel = { onmessage: (msg: unknown) => void };

describe("Tauri LLM client", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("forwards complete() to llm_complete", async () => {
    invoke.mockResolvedValue("好的");
    const req = { messages: [{ role: "user" as const, content: "hi" }], json: true };
    await expect(createTauriLlmClient().complete(req)).resolves.toBe("好的");
    expect(invoke).toHaveBeenCalledWith("llm_complete", { req });
  });

  it("waits for the done event before resolving stream()", async () => {
    let channel!: FakeChannel;
    invoke.mockImplementation(async (_cmd: string, args: { channel: FakeChannel }) => {
      channel = args.channel;
      channel.onmessage({ event: "delta", data: "你" });
      setTimeout(() => {
        channel.onmessage({ event: "delta", data: "好" });
        channel.onmessage({ event: "done" });
      }, 5);
      return "你好";
    });
    const deltas: string[] = [];
    const full = await createTauriLlmClient().stream!(
      { messages: [{ role: "user", content: "hi" }] },
      (d) => deltas.push(d),
    );
    expect(full).toBe("你好");
    expect(deltas).toEqual(["你", "好"]);
    expect(invoke.mock.calls[0][0]).toBe("llm_stream");
  });

  it("propagates Rust error messages", async () => {
    invoke.mockRejectedValue("API Key 无效或已过期（401）");
    await expect(
      createTauriLlmClient().stream!({ messages: [] }, () => {}),
    ).rejects.toBe("API Key 无效或已过期（401）");
  });
});
