import { describe, it, expect, vi } from "vitest";
import { Readable, Writable } from "stream";
import { JsonlReader, sendRpcCommand, createRpcClient } from "../../../pi/rpc-client.js";

const tick = () => new Promise((r) => setImmediate(r));

describe("JsonlReader", () => {
  it("parses a single JSONL line", async () => {
    const onMessage = vi.fn();
    const stream = new Readable({ read() {} });
    new JsonlReader(stream, onMessage);

    stream.push('{"type":"agent_start"}\n');
    await tick();

    expect(onMessage).toHaveBeenCalledWith({ type: "agent_start" });
  });

  it("parses multiple lines in one chunk", async () => {
    const onMessage = vi.fn();
    const stream = new Readable({ read() {} });
    new JsonlReader(stream, onMessage);

    stream.push('{"type":"agent_start"}\n{"type":"agent_end","messages":[]}\n');
    await tick();

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledWith({ type: "agent_start" });
    expect(onMessage).toHaveBeenCalledWith({ type: "agent_end", messages: [] });
  });

  it("handles split chunks (partial lines)", async () => {
    const onMessage = vi.fn();
    const stream = new Readable({ read() {} });
    new JsonlReader(stream, onMessage);

    stream.push('{"type":"agen');
    await tick();
    expect(onMessage).not.toHaveBeenCalled();

    stream.push('t_start"}\n');
    await tick();
    expect(onMessage).toHaveBeenCalledWith({ type: "agent_start" });
  });

  it("ignores empty lines", async () => {
    const onMessage = vi.fn();
    const stream = new Readable({ read() {} });
    new JsonlReader(stream, onMessage);

    stream.push('\n\n{"type":"test"}\n\n');
    await tick();

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: "test" });
  });

  it("ignores malformed JSON lines without crashing", async () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const stream = new Readable({ read() {} });
    new JsonlReader(stream, onMessage, onError);

    stream.push('not json\n{"type":"valid"}\n');
    await tick();

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: "valid" });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("handles JSON with escaped newlines in string values", async () => {
    const onMessage = vi.fn();
    const stream = new Readable({ read() {} });
    new JsonlReader(stream, onMessage);

    stream.push('{"type":"text","data":"line1\\nline2"}\n');
    await tick();

    expect(onMessage).toHaveBeenCalledWith({
      type: "text",
      data: "line1\nline2",
    });
  });
});

describe("sendRpcCommand", () => {
  it("writes JSON followed by newline to stdin", () => {
    const chunks = [];
    const stdin = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });

    sendRpcCommand(stdin, { type: "prompt", message: "hello" });

    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0].trim());
    expect(parsed).toEqual({ type: "prompt", message: "hello" });
    expect(chunks[0].endsWith("\n")).toBe(true);
  });
});

describe("createRpcClient", () => {
  it("creates reader and provides send function", async () => {
    const chunks = [];
    const stdout = new Readable({ read() {} });
    const stdin = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });

    const onEvent = vi.fn();
    const client = createRpcClient(stdout, stdin, onEvent);

    client.send({ type: "prompt", message: "test" });
    expect(chunks).toHaveLength(1);

    stdout.push('{"type":"agent_start"}\n');
    await tick();
    expect(onEvent).toHaveBeenCalledWith({ type: "agent_start" });
  });
});
