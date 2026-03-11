import { StoreKey } from "../app/constant";
import { DEFAULT_ACCESS_STATE, useAccessStore } from "../app/store/access";
import { DEFAULT_CONFIG } from "../app/store/config";
import { chunkUtf8String } from "../app/utils/cloud/upstash";
import {
  BackupPayload,
  BackupValidationError,
  createBackupEnvelope,
  mergeAppState,
  mergeWithUpdate,
  parseBackupContent,
  setLocalAppState,
} from "../app/utils/sync";

function createPayload(overrides: any = {}) {
  return {
    chat: {
      sessions: [],
      deletedSessions: {},
    },
    access: {
      ...DEFAULT_ACCESS_STATE,
      lastUpdateTime: 0,
    },
    config: {
      ...DEFAULT_CONFIG,
      lastUpdate: 0,
    },
    mask: {
      masks: {},
      language: undefined,
      lastUpdateTime: 0,
    },
    prompt: {
      counter: 0,
      prompts: {},
      lastUpdateTime: 0,
    },
    plugin: {
      plugins: {},
      lastUpdateTime: 0,
    },
    sd: {
      currentId: 0,
      draw: [],
      currentModel: {
        name: "test-model",
        value: "test-model",
      },
      currentParams: {},
      lastUpdateTime: 0,
    },
    mcp: {
      config: {
        mcpServers: {},
      },
      updatedAt: 0,
    },
    ...overrides,
  } as BackupPayload;
}

function createMask(overrides: Record<string, unknown> = {}) {
  return {
    id: "mask-1",
    createdAt: 1,
    updatedAt: 1,
    avatar: "bot",
    name: "Mask",
    context: [],
    syncGlobalConfig: true,
    modelConfig: {
      ...DEFAULT_CONFIG.modelConfig,
      model: "gpt-4o-mini",
      providerName: "OpenAI",
    },
    lang: "en",
    builtin: false,
    ...overrides,
  };
}

describe("backup and sync helpers", () => {
  beforeEach(() => {
    useAccessStore.setState({
      ...DEFAULT_ACCESS_STATE,
      lastUpdateTime: 0,
    });
  });

  test("mergeWithUpdate prefers the newer state", () => {
    expect(
      mergeWithUpdate(
        { lastUpdateTime: 10, value: "local" },
        { lastUpdateTime: 20, value: "remote" },
      ),
    ).toEqual({
      lastUpdateTime: 20,
      value: "remote",
    });

    expect(
      mergeWithUpdate(
        { lastUpdateTime: 30, value: "local" },
        { lastUpdateTime: 20, value: "remote" },
      ),
    ).toEqual({
      lastUpdateTime: 30,
      value: "local",
    });
  });

  test("chat tombstones remove deleted sessions during merge", () => {
    const merged = mergeAppState(
      createPayload({
        chat: {
          sessions: [
            {
              id: "session-1",
              topic: "Local",
              memoryPrompt: "",
              messages: [],
              stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
              lastUpdate: 100,
              lastSummarizeIndex: 0,
              mask: createMask(),
            },
          ],
          deletedSessions: {},
        },
      }),
      createPayload({
        chat: {
          sessions: [],
          deletedSessions: {
            "session-1": 200,
          },
        },
      }),
    );

    expect(merged.chat.sessions).toHaveLength(0);
    expect(merged.chat.deletedSessions["session-1"]).toBe(200);
  });

  test("chat metadata and record stores prefer newer updates", () => {
    const merged = mergeAppState(
      createPayload({
        chat: {
          sessions: [
            {
              id: "session-1",
              topic: "Local Topic",
              memoryPrompt: "local memory",
              messages: [
                {
                  id: "msg-1",
                  role: "user",
                  content: "hello",
                  createdAt: 100,
                  date: "2024-01-01 10:00:00",
                },
              ],
              stat: { tokenCount: 1, wordCount: 1, charCount: 5 },
              lastUpdate: 100,
              lastSummarizeIndex: 0,
              clearContextIndex: 1,
              mask: createMask({ name: "Local Mask", updatedAt: 100 }),
            },
          ],
          deletedSessions: {},
        },
        prompt: {
          counter: 1,
          prompts: {
            prompt_1: {
              id: "prompt_1",
              title: "Local Prompt",
              content: "local",
              createdAt: 1,
              updatedAt: 10,
              isUser: true,
            },
          },
          lastUpdateTime: 10,
        },
        plugin: {
          plugins: {
            plugin_1: {
              id: "plugin_1",
              title: "Local Plugin",
              version: "1.0.0",
              content: "{}",
              builtin: false,
              createdAt: 1,
              updatedAt: 10,
            },
          },
          lastUpdateTime: 10,
        },
        sd: {
          currentId: 1,
          draw: [
            {
              id: "draw-1",
              status: "running",
              updatedAt: 10,
            },
          ],
          currentModel: {
            name: "test-model",
            value: "test-model",
          },
          currentParams: {},
          lastUpdateTime: 10,
        },
      }),
      createPayload({
        chat: {
          sessions: [
            {
              id: "session-1",
              topic: "Remote Topic",
              memoryPrompt: "remote memory",
              messages: [
                {
                  id: "msg-2",
                  role: "assistant",
                  content: "world",
                  createdAt: 200,
                  date: "2024-01-01 10:01:00",
                },
              ],
              stat: { tokenCount: 2, wordCount: 1, charCount: 5 },
              lastUpdate: 200,
              lastSummarizeIndex: 1,
              clearContextIndex: 2,
              mask: createMask({ name: "Remote Mask", updatedAt: 200 }),
            },
          ],
          deletedSessions: {},
        },
        prompt: {
          counter: 2,
          prompts: {
            prompt_1: {
              id: "prompt_1",
              title: "Remote Prompt",
              content: "remote",
              createdAt: 1,
              updatedAt: 20,
              isUser: true,
            },
          },
          lastUpdateTime: 20,
        },
        plugin: {
          plugins: {
            plugin_1: {
              id: "plugin_1",
              title: "Remote Plugin",
              version: "1.0.0",
              content: "{\"openapi\":\"3.0.0\"}",
              builtin: false,
              createdAt: 1,
              updatedAt: 20,
            },
          },
          lastUpdateTime: 20,
        },
        sd: {
          currentId: 2,
          draw: [
            {
              id: "draw-1",
              status: "success",
              updatedAt: 20,
            },
          ],
          currentModel: {
            name: "test-model",
            value: "test-model",
          },
          currentParams: {},
          lastUpdateTime: 20,
        },
      }),
    );

    expect(merged.chat.sessions[0].topic).toBe("Remote Topic");
    expect(merged.chat.sessions[0].memoryPrompt).toBe("remote memory");
    expect(merged.chat.sessions[0].clearContextIndex).toBe(2);
    expect(merged.chat.sessions[0].mask.name).toBe("Remote Mask");
    expect(merged.chat.sessions[0].messages.map((message) => message.id)).toEqual([
      "msg-1",
      "msg-2",
    ]);
    expect(merged.prompt.prompts.prompt_1.title).toBe("Remote Prompt");
    expect(merged.plugin.plugins.plugin_1.title).toBe("Remote Plugin");
    expect(merged.sd.draw[0].status).toBe("success");
  });

  test("setLocalAppState preserves a verified access code when the code is unchanged", async () => {
    useAccessStore.setState({
      ...DEFAULT_ACCESS_STATE,
      accessCode: "secret-code",
      validatedAccessCode: "secret-code",
      needCode: true,
      lastUpdateTime: 10,
    });

    await setLocalAppState(
      createPayload({
        access: {
          accessCode: "secret-code",
          needCode: true,
          lastUpdateTime: 20,
        },
      }),
    );

    expect(useAccessStore.getState().accessCode).toBe("secret-code");
    expect(useAccessStore.getState().validatedAccessCode).toBe("secret-code");
  });

  test("setLocalAppState clears a verified access code when the code changes", async () => {
    useAccessStore.setState({
      ...DEFAULT_ACCESS_STATE,
      accessCode: "secret-code",
      validatedAccessCode: "secret-code",
      needCode: true,
      lastUpdateTime: 10,
    });

    await setLocalAppState(
      createPayload({
        access: {
          accessCode: "new-secret-code",
          needCode: true,
          lastUpdateTime: 20,
        },
      }),
    );

    expect(useAccessStore.getState().accessCode).toBe("new-secret-code");
    expect(useAccessStore.getState().validatedAccessCode).toBe("");
  });

  test("parseBackupContent supports legacy backups and rejects tampering", () => {
    const legacyBackup = {
      [StoreKey.Chat]: {
        sessions: [],
        deletedSessionIds: ["session-1"],
      },
    };

    const parsedLegacy = parseBackupContent(JSON.stringify(legacyBackup));
    expect(parsedLegacy.schemaVersion).toBe(2);
    expect(parsedLegacy.payload.chat.deletedSessions["session-1"]).toBeGreaterThan(
      0,
    );

    const { content } = createBackupEnvelope(
      createPayload({
        prompt: {
          counter: 1,
          prompts: {},
          lastUpdateTime: 0,
        },
      }),
      "revision-1",
    );
    const tampered = JSON.parse(content);
    tampered.hash = "broken";

    expect(() => parseBackupContent(JSON.stringify(tampered))).toThrow(
      BackupValidationError,
    );
  });

  test("chunkUtf8String keeps whitespace and multibyte content intact", () => {
    const content = "line 1\nline  2  with spaces\n你好，世界 🚀";
    const chunks = Array.from(chunkUtf8String(content, 7));

    expect(chunks.join("")).toBe(content);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
