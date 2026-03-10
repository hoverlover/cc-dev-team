import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPiArgs, mapEventToStatus, AgentStatusTracker } from "../../../pi/broker-rpc.js";

describe("buildPiArgs", () => {
  it("builds basic args for RPC mode", () => {
    const args = buildPiArgs({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });

    expect(args).toContain("--mode");
    expect(args).toContain("rpc");
    expect(args).toContain("--provider");
    expect(args).toContain("anthropic");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-20250514");
    expect(args).toContain("--no-session");
  });

  it("includes extension path when provided", () => {
    const args = buildPiArgs({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      extensionPath: "/path/to/extension.ts",
    });

    expect(args).toContain("-e");
    expect(args).toContain("/path/to/extension.ts");
  });

  it("includes multiple extensions", () => {
    const args = buildPiArgs({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      extensionPath: ["/ext1.ts", "/ext2.ts"],
    });

    const eIndices = args.reduce((acc, v, i) => (v === "-e" ? [...acc, i] : acc), []);
    expect(eIndices).toHaveLength(2);
    expect(args[eIndices[0] + 1]).toBe("/ext1.ts");
    expect(args[eIndices[1] + 1]).toBe("/ext2.ts");
  });

  it("includes system prompt path when provided", () => {
    const args = buildPiArgs({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      systemPromptPath: "/path/to/agents/pm/SYSTEM.md",
    });

    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("/path/to/agents/pm/SYSTEM.md");
  });

  it("omits --append-system-prompt when no systemPromptPath", () => {
    const args = buildPiArgs({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });

    expect(args).not.toContain("--append-system-prompt");
  });

  it("includes thinking level when provided", () => {
    const args = buildPiArgs({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      thinking: "medium",
    });

    expect(args).toContain("--thinking");
    expect(args).toContain("medium");
  });
});

describe("mapEventToStatus", () => {
  it("maps agent_start to working", () => {
    expect(mapEventToStatus({ type: "agent_start" })).toBe("working");
  });

  it("maps tool_execution_start to working with tool name", () => {
    const result = mapEventToStatus({
      type: "tool_execution_start",
      toolName: "bash",
    });
    expect(result).toBe("working:bash");
  });

  it("maps tool_execution_end to working", () => {
    expect(mapEventToStatus({ type: "tool_execution_end" })).toBe("working");
  });

  it("maps message_update text_delta to thinking", () => {
    const result = mapEventToStatus({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta" },
    });
    expect(result).toBe("thinking");
  });

  it("maps agent_end to idle", () => {
    expect(mapEventToStatus({ type: "agent_end" })).toBe("idle");
  });

  it("returns null for unmapped events", () => {
    expect(mapEventToStatus({ type: "response" })).toBeNull();
  });
});

describe("AgentStatusTracker", () => {
  it("starts with idle status", () => {
    const tracker = new AgentStatusTracker();
    expect(tracker.get("pm")).toBe("idle");
  });

  it("updates status from events", () => {
    const tracker = new AgentStatusTracker();

    tracker.processEvent("pm", { type: "agent_start" });
    expect(tracker.get("pm")).toBe("working");

    tracker.processEvent("pm", { type: "agent_end" });
    expect(tracker.get("pm")).toBe("idle");
  });

  it("tracks multiple agents independently", () => {
    const tracker = new AgentStatusTracker();

    tracker.processEvent("pm", { type: "agent_start" });
    tracker.processEvent("architect", { type: "agent_start" });

    expect(tracker.get("pm")).toBe("working");
    expect(tracker.get("architect")).toBe("working");

    tracker.processEvent("pm", { type: "agent_end" });
    expect(tracker.get("pm")).toBe("idle");
    expect(tracker.get("architect")).toBe("working");
  });

  it("emits change events", () => {
    const tracker = new AgentStatusTracker();
    const onChange = vi.fn();
    tracker.onChange(onChange);

    tracker.processEvent("pm", { type: "agent_start" });

    expect(onChange).toHaveBeenCalledWith("pm", "working", "idle");
  });

  it("does not emit when status unchanged", () => {
    const tracker = new AgentStatusTracker();
    const onChange = vi.fn();

    tracker.processEvent("pm", { type: "agent_start" });
    tracker.onChange(onChange);
    tracker.processEvent("pm", { type: "tool_execution_end" }); // still "working"

    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns all statuses", () => {
    const tracker = new AgentStatusTracker();
    tracker.processEvent("pm", { type: "agent_start" });
    tracker.processEvent("engineer", { type: "agent_end" });

    const all = tracker.getAll();
    expect(all).toEqual({ pm: "working", engineer: "idle" });
  });
});
