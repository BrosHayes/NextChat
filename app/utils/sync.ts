import SparkMD5 from "spark-md5";
import { nanoid } from "nanoid";
import { StoreKey } from "../constant";
import { DEFAULT_ACCESS_STATE, useAccessStore } from "../store/access";
import {
  ChatMessage,
  ChatSession,
  DEFAULT_CHAT_STATE,
  DEFAULT_TOPIC,
  DeletedSessionMap,
  useChatStore,
} from "../store/chat";
import { DEFAULT_CONFIG, useAppConfig } from "../store/config";
import {
  DEFAULT_MASK_STATE,
  Mask,
  createEmptyMask,
  useMaskStore,
} from "../store/mask";
import {
  DEFAULT_PLUGIN_STATE,
  FunctionToolService,
  Plugin,
  usePluginStore,
} from "../store/plugin";
import {
  DEFAULT_PROMPT_STATE,
  Prompt,
  SearchService,
  usePromptStore,
} from "../store/prompt";
import { DEFAULT_SD_STATE, useSdStore } from "../store/sd";
import { DEFAULT_MCP_CONFIG, McpConfigData } from "../mcp/types";
import { merge } from "./merge";
import { safeLocalStorage } from "../utils";

const BACKUP_SCHEMA_VERSION = 2 as const;
const MCP_CONFIG_API_PATH = "/api/mcp/config";
const MCP_LOCAL_STORAGE_KEY = `${StoreKey.Mcp}-backup`;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];
type NonFunctionFields<T> = Pick<T, NonFunctionKeys<T>>;
type StripHydration<T> = Omit<T, "_hasHydrated">;

type AccessStoreState = StripHydration<GetStoreState<typeof useAccessStore>>;
type AccessBackupState = Omit<AccessStoreState, "validatedAccessCode">;
type ConfigStoreState = StripHydration<GetStoreState<typeof useAppConfig>>;
type PromptStoreState = StripHydration<GetStoreState<typeof usePromptStore>>;
type MaskStoreState = StripHydration<GetStoreState<typeof useMaskStore>>;
type PluginStoreState = StripHydration<GetStoreState<typeof usePluginStore>>;
type SdStoreState = StripHydration<GetStoreState<typeof useSdStore>>;

export type ChatBackupState = {
  sessions: ChatSession[];
  deletedSessions: DeletedSessionMap;
};

export type PromptBackupState = Pick<
  PromptStoreState,
  "counter" | "prompts" | "lastUpdateTime"
>;

export type MaskBackupState = Pick<
  MaskStoreState,
  "masks" | "language" | "lastUpdateTime"
>;

export type PluginBackupState = Pick<
  PluginStoreState,
  "plugins" | "lastUpdateTime"
>;

export type SdBackupState = Pick<
  SdStoreState,
  "currentId" | "draw" | "currentModel" | "currentParams" | "lastUpdateTime"
>;

export type McpBackupState = {
  config: McpConfigData;
  updatedAt: number;
};

export type BackupPayload = {
  chat: ChatBackupState;
  access: AccessBackupState;
  config: ConfigStoreState;
  mask: MaskBackupState;
  prompt: PromptBackupState;
  plugin: PluginBackupState;
  sd: SdBackupState;
  mcp: McpBackupState;
};

export type BackupEnvelopeV2 = {
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  revision: string;
  updatedAt: number;
  hash: string;
  payload: BackupPayload;
};

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

export function getNonFunctionFileds<T extends object>(obj: T) {
  const ret: any = {};

  Object.entries(obj).forEach(([k, v]) => {
    if (typeof v !== "function") {
      ret[k] = v;
    }
  });

  return ret as NonFunctionFields<T>;
}

export type GetStoreState<T> = T extends { getState: () => infer U }
  ? NonFunctionFields<U>
  : never;

function deepCopy<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function getMcpStorage() {
  return safeLocalStorage();
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown, fallback: number) {
  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? new Date(value).getTime()
      : NaN;

  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function formatMessageDate(createdAt: number) {
  return new Date(createdAt).toLocaleString();
}

function hashPayload(payload: BackupPayload) {
  return SparkMD5.hash(JSON.stringify(payload));
}

function createDefaultAccessBackupState() {
  const { validatedAccessCode: _validatedAccessCode, ...defaultAccessState } =
    DEFAULT_ACCESS_STATE;

  return {
    ...deepCopy(defaultAccessState),
    lastUpdateTime: 0,
  } satisfies AccessBackupState;
}

function createDefaultBackupPayload(): BackupPayload {
  return deepCopy({
    chat: {
      sessions: DEFAULT_CHAT_STATE.sessions,
      deletedSessions: DEFAULT_CHAT_STATE.deletedSessions,
    },
    access: {
      ...createDefaultAccessBackupState(),
    },
    config: {
      ...DEFAULT_CONFIG,
      lastUpdateTime: 0,
    },
    mask: {
      ...DEFAULT_MASK_STATE,
      lastUpdateTime: 0,
    },
    prompt: {
      ...DEFAULT_PROMPT_STATE,
      lastUpdateTime: 0,
    },
    plugin: {
      ...DEFAULT_PLUGIN_STATE,
      lastUpdateTime: 0,
    },
    sd: {
      ...DEFAULT_SD_STATE,
      lastUpdateTime: 0,
    },
    mcp: {
      config: DEFAULT_MCP_CONFIG,
      updatedAt: 0,
    },
  });
}

function normalizeDeletedSessions(state: {
  deletedSessions?: DeletedSessionMap;
  deletedSessionIds?: string[];
}) {
  const deletedSessions: DeletedSessionMap = {};

  Object.entries(state.deletedSessions ?? {}).forEach(([id, deletedAt]) => {
    deletedSessions[id] = normalizeTimestamp(deletedAt, Date.now());
  });

  (state.deletedSessionIds ?? []).forEach((id) => {
    deletedSessions[id] = Math.max(
      deletedSessions[id] ?? 0,
      normalizeTimestamp(undefined, Date.now()),
    );
  });

  return deletedSessions;
}

function normalizeMessage(message: Partial<ChatMessage>) {
  const now = Date.now();
  const createdAt = normalizeTimestamp(
    message.createdAt,
    normalizeTimestamp(message.date, now),
  );

  return {
    id: message.id ?? nanoid(),
    role: message.role ?? "user",
    content: message.content ?? "",
    ...message,
    createdAt,
    date: message.date ?? formatMessageDate(createdAt),
  } as ChatMessage;
}

function normalizeMask(mask: Partial<Mask> | undefined): Mask {
  const fallback = createEmptyMask();
  const normalizedContext = Array.isArray(mask?.context)
    ? mask!.context.map(normalizeMessage)
    : fallback.context;
  const createdAt = normalizeTimestamp(mask?.createdAt, fallback.createdAt);

  return {
    ...fallback,
    ...deepCopy(mask ?? {}),
    context: normalizedContext,
    createdAt,
    updatedAt: normalizeTimestamp(mask?.updatedAt, createdAt),
  };
}

function normalizeChatSession(session: Partial<ChatSession>): ChatSession {
  const messages = Array.isArray(session.messages)
    ? session.messages
        .map(normalizeMessage)
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const latestMessageAt = messages.at(-1)?.createdAt ?? Date.now();
  const lastUpdate = normalizeTimestamp(session.lastUpdate, latestMessageAt);

  return {
    id: session.id ?? nanoid(),
    topic: session.topic ?? DEFAULT_TOPIC,
    memoryPrompt:
      typeof session.memoryPrompt === "string" ? session.memoryPrompt : "",
    messages,
    stat: {
      tokenCount: Number(session.stat?.tokenCount ?? 0),
      wordCount: Number(session.stat?.wordCount ?? 0),
      charCount: Number(session.stat?.charCount ?? 0),
    },
    lastUpdate,
    lastSummarizeIndex: Number(session.lastSummarizeIndex ?? 0),
    clearContextIndex:
      typeof session.clearContextIndex === "number"
        ? session.clearContextIndex
        : undefined,
    mask: normalizeMask(session.mask),
  };
}

function normalizePrompt(prompt: Partial<Prompt>) {
  const createdAt = normalizeTimestamp(prompt.createdAt, Date.now());

  return {
    id: prompt.id ?? nanoid(),
    title: prompt.title ?? "",
    content: prompt.content ?? "",
    isUser: prompt.isUser ?? true,
    createdAt,
    updatedAt: normalizeTimestamp(prompt.updatedAt, createdAt),
  } as Prompt;
}

function normalizePlugin(plugin: Partial<Plugin>) {
  const createdAt = normalizeTimestamp(plugin.createdAt, Date.now());

  return {
    id: plugin.id ?? nanoid(),
    title: plugin.title ?? "",
    version: plugin.version ?? "1.0.0",
    content: plugin.content ?? "",
    builtin: plugin.builtin ?? false,
    authType: plugin.authType,
    authLocation: plugin.authLocation,
    authHeader: plugin.authHeader,
    authToken: plugin.authToken,
    createdAt,
    updatedAt: normalizeTimestamp(plugin.updatedAt, createdAt),
  } as Plugin;
}

function normalizeRecord<T extends { id: string }>(
  value: Record<string, T> | undefined,
  normalizer: (item: T) => T,
) {
  const normalized: Record<string, T> = {};

  Object.entries(isRecord(value) ? value : {}).forEach(([key, item]) => {
    const normalizedItem = normalizer(item);
    normalized[normalizedItem.id || key] = normalizedItem;
  });

  return normalized;
}

function normalizePromptState(state: Partial<PromptBackupState> | undefined) {
  return {
    counter: Number(state?.counter ?? 0),
    lastUpdateTime: normalizeTimestamp(state?.lastUpdateTime, 0),
    prompts: normalizeRecord(state?.prompts, normalizePrompt),
  } as PromptBackupState;
}

function normalizeMaskState(state: Partial<MaskBackupState> | undefined) {
  return {
    language: state?.language,
    lastUpdateTime: normalizeTimestamp(state?.lastUpdateTime, 0),
    masks: normalizeRecord(state?.masks, normalizeMask),
  } as MaskBackupState;
}

function normalizePluginState(state: Partial<PluginBackupState> | undefined) {
  return {
    lastUpdateTime: normalizeTimestamp(state?.lastUpdateTime, 0),
    plugins: normalizeRecord(state?.plugins, normalizePlugin),
  } as PluginBackupState;
}

function normalizeAccessState(state: Partial<AccessBackupState> | undefined) {
  const normalized = createDefaultAccessBackupState();

  merge(normalized, state ?? {});
  delete (normalized as Partial<AccessStoreState>).validatedAccessCode;
  normalized.lastUpdateTime = normalizeTimestamp(state?.lastUpdateTime, 0);

  return normalized satisfies AccessBackupState;
}

function normalizeConfigState(state: Partial<ConfigStoreState> | undefined) {
  const normalized = deepCopy({
    ...DEFAULT_CONFIG,
    lastUpdateTime: 0,
  }) as ConfigStoreState;

  merge(normalized, state ?? {});
  normalized.lastUpdateTime = normalizeTimestamp(state?.lastUpdateTime, 0);

  return normalized;
}

function normalizeSdState(state: Partial<SdBackupState> | undefined) {
  const normalized = deepCopy({
    ...DEFAULT_SD_STATE,
    lastUpdateTime: 0,
  }) as SdBackupState;

  merge(normalized, state ?? {});
  normalized.lastUpdateTime = normalizeTimestamp(state?.lastUpdateTime, 0);
  normalized.currentId = Number(state?.currentId ?? normalized.currentId ?? 0);
  normalized.draw = Array.isArray(state?.draw)
    ? state!.draw.map((item: any) => ({
        ...item,
        id: item.id ?? nanoid(),
        updatedAt: normalizeTimestamp(item.updatedAt, Date.now()),
      }))
    : [];

  return normalized;
}

function normalizeMcpState(state: Partial<McpBackupState> | undefined) {
  return {
    config:
      state?.config && isRecord(state.config)
        ? (deepCopy(state.config) as McpConfigData)
        : deepCopy(DEFAULT_MCP_CONFIG),
    updatedAt: normalizeTimestamp(state?.updatedAt, 0),
  };
}

function readMcpBackupStateFromStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = getMcpStorage().getItem(MCP_LOCAL_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    assertSafeJsonValue(parsed);
    return normalizeMcpState(parsed as Partial<McpBackupState>);
  } catch (error) {
    console.warn("[Sync] failed to parse local MCP backup state", error);
    return null;
  }
}

function writeMcpBackupStateToStorage(state: McpBackupState) {
  if (typeof window === "undefined") {
    return;
  }

  getMcpStorage().setItem(
    MCP_LOCAL_STORAGE_KEY,
    JSON.stringify(normalizeMcpState(state)),
  );
}

function normalizeChatState(state: Partial<ChatBackupState> | undefined) {
  const sessions = state?.sessions;
  const normalizedSessions = Array.isArray(sessions)
    ? sessions.map(normalizeChatSession)
    : deepCopy(DEFAULT_CHAT_STATE.sessions).map(normalizeChatSession);

  return {
    sessions: normalizedSessions,
    deletedSessions: normalizeDeletedSessions(state ?? {}),
  } satisfies ChatBackupState;
}

function normalizeBackupPayload(value: Partial<BackupPayload> | undefined) {
  const defaults = createDefaultBackupPayload();

  return {
    chat: normalizeChatState(value?.chat ?? defaults.chat),
    access: normalizeAccessState(value?.access ?? defaults.access),
    config: normalizeConfigState(value?.config ?? defaults.config),
    mask: normalizeMaskState(value?.mask ?? defaults.mask),
    prompt: normalizePromptState(value?.prompt ?? defaults.prompt),
    plugin: normalizePluginState(value?.plugin ?? defaults.plugin),
    sd: normalizeSdState(value?.sd ?? defaults.sd),
    mcp: normalizeMcpState(value?.mcp ?? defaults.mcp),
  } satisfies BackupPayload;
}

function assertSafeJsonValue(value: unknown, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeJsonValue(item, `${path}[${index}]`),
    );
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([key, child]) => {
    if (DANGEROUS_KEYS.has(key)) {
      throw new BackupValidationError(`Unsafe backup key at ${path}.${key}`);
    }

    assertSafeJsonValue(child, `${path}.${key}`);
  });
}

function isBackupEnvelopeV2(value: unknown): value is BackupEnvelopeV2 {
  return (
    isRecord(value) &&
    value.schemaVersion === BACKUP_SCHEMA_VERSION &&
    typeof value.revision === "string" &&
    typeof value.hash === "string" &&
    isRecord(value.payload)
  );
}

function looksLikeLegacyAppState(
  value: unknown,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (StoreKey.Chat in value ||
      StoreKey.Access in value ||
      StoreKey.Config in value ||
      StoreKey.Mask in value ||
      StoreKey.Prompt in value ||
      StoreKey.Plugin in value ||
      StoreKey.SdList in value ||
      StoreKey.Mcp in value)
  );
}

function normalizeLegacyPayload(value: Record<string, unknown>) {
  return normalizeBackupPayload({
    chat: value[StoreKey.Chat] as ChatBackupState,
    access: value[StoreKey.Access] as AccessBackupState,
    config: value[StoreKey.Config] as ConfigStoreState,
    mask: value[StoreKey.Mask] as MaskBackupState,
    prompt: value[StoreKey.Prompt] as PromptBackupState,
    plugin: value[StoreKey.Plugin] as PluginBackupState,
    sd: value[StoreKey.SdList] as SdBackupState,
    mcp: value[StoreKey.Mcp] as McpBackupState,
  });
}

function getMessageScore(message: ChatMessage) {
  const contentLength =
    typeof message.content === "string"
      ? message.content.length
      : JSON.stringify(message.content).length;

  return (
    contentLength +
    (message.streaming ? 0 : 10_000) +
    (message.tools?.length ?? 0) * 100
  );
}

function mergeMessages(
  localMessages: ChatMessage[],
  remoteMessages: ChatMessage[],
) {
  const merged = new Map<string, ChatMessage>();

  [...localMessages, ...remoteMessages].forEach((rawMessage) => {
    const message = normalizeMessage(rawMessage);
    const existing = merged.get(message.id);

    if (!existing) {
      merged.set(message.id, message);
      return;
    }

    const shouldUseIncoming =
      message.createdAt > existing.createdAt ||
      (message.createdAt === existing.createdAt &&
        getMessageScore(message) >= getMessageScore(existing));

    merged.set(
      message.id,
      shouldUseIncoming ? { ...existing, ...message } : existing,
    );
  });

  return Array.from(merged.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function mergeDeletedSessions(...deletedSessionsList: DeletedSessionMap[]) {
  return deletedSessionsList.reduce<DeletedSessionMap>((all, current) => {
    Object.entries(current).forEach(([id, deletedAt]) => {
      all[id] = Math.max(all[id] ?? 0, deletedAt);
    });
    return all;
  }, {});
}

function mergeChatState(
  localState: ChatBackupState,
  remoteState: ChatBackupState,
) {
  const local = normalizeChatState(localState);
  const remote = normalizeChatState(remoteState);
  const deletedSessions = mergeDeletedSessions(
    local.deletedSessions,
    remote.deletedSessions,
  );
  const mergedSessions: Record<string, ChatSession> = {};

  local.sessions.forEach((session) => {
    mergedSessions[session.id] = normalizeChatSession(session);
  });

  remote.sessions.forEach((remoteSession) => {
    if (deletedSessions[remoteSession.id]) {
      return;
    }

    const localSession = mergedSessions[remoteSession.id];
    const normalizedRemoteSession = normalizeChatSession(remoteSession);

    if (!localSession) {
      mergedSessions[normalizedRemoteSession.id] = normalizedRemoteSession;
      return;
    }

    const remoteNewer =
      normalizedRemoteSession.lastUpdate > localSession.lastUpdate;
    const preferredSession = remoteNewer
      ? normalizedRemoteSession
      : localSession;
    const mergedMessages = mergeMessages(
      localSession.messages,
      normalizedRemoteSession.messages,
    );

    mergedSessions[normalizedRemoteSession.id] = {
      ...preferredSession,
      messages: mergedMessages,
      mask: remoteNewer
        ? normalizeMask(normalizedRemoteSession.mask)
        : normalizeMask(localSession.mask),
      lastUpdate: Math.max(
        localSession.lastUpdate,
        normalizedRemoteSession.lastUpdate,
        mergedMessages.at(-1)?.createdAt ?? 0,
      ),
    };
  });

  const sessions = Object.values(mergedSessions)
    .filter((session) => !deletedSessions[session.id])
    .sort((a, b) => b.lastUpdate - a.lastUpdate);

  return {
    sessions,
    deletedSessions,
  } satisfies ChatBackupState;
}

function mergeRecordByUpdatedAt<T extends { id: string; updatedAt?: number }>(
  localState: Record<string, T>,
  remoteState: Record<string, T>,
) {
  const merged = new Map<string, T>();

  [...Object.values(localState), ...Object.values(remoteState)].forEach(
    (item) => {
      const existing = merged.get(item.id);

      if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
        merged.set(item.id, item);
      }
    },
  );

  return Object.fromEntries(
    Array.from(merged.values()).map((item) => [item.id, item]),
  ) as Record<string, T>;
}

function mergePromptState(
  localState: PromptBackupState,
  remoteState: PromptBackupState,
) {
  const local = normalizePromptState(localState);
  const remote = normalizePromptState(remoteState);
  const base = mergeWithUpdate(
    { ...local, prompts: {} },
    { ...remote, prompts: {} },
  );

  return {
    ...base,
    counter: Math.max(local.counter, remote.counter),
    prompts: mergeRecordByUpdatedAt(local.prompts, remote.prompts),
    lastUpdateTime: Math.max(
      local.lastUpdateTime ?? 0,
      remote.lastUpdateTime ?? 0,
    ),
  } satisfies PromptBackupState;
}

function mergeMaskState(
  localState: MaskBackupState,
  remoteState: MaskBackupState,
) {
  const local = normalizeMaskState(localState);
  const remote = normalizeMaskState(remoteState);
  const base = mergeWithUpdate(
    { ...local, masks: {} },
    { ...remote, masks: {} },
  );

  return {
    ...base,
    masks: mergeRecordByUpdatedAt(local.masks, remote.masks),
    lastUpdateTime: Math.max(
      local.lastUpdateTime ?? 0,
      remote.lastUpdateTime ?? 0,
    ),
  } satisfies MaskBackupState;
}

function mergePluginState(
  localState: PluginBackupState,
  remoteState: PluginBackupState,
) {
  const local = normalizePluginState(localState);
  const remote = normalizePluginState(remoteState);

  return {
    ...mergeWithUpdate({ ...local, plugins: {} }, { ...remote, plugins: {} }),
    plugins: mergeRecordByUpdatedAt(local.plugins, remote.plugins),
    lastUpdateTime: Math.max(
      local.lastUpdateTime ?? 0,
      remote.lastUpdateTime ?? 0,
    ),
  } satisfies PluginBackupState;
}

function mergeSdState(localState: SdBackupState, remoteState: SdBackupState) {
  const local = normalizeSdState(localState);
  const remote = normalizeSdState(remoteState);
  const base = mergeWithUpdate({ ...local, draw: [] }, { ...remote, draw: [] });
  const drawById = new Map<string, any>();

  [...local.draw, ...remote.draw].forEach((item: any) => {
    const existing = drawById.get(item.id);

    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      drawById.set(item.id, item);
    }
  });

  return {
    ...base,
    currentId: Math.max(local.currentId ?? 0, remote.currentId ?? 0),
    draw: Array.from(drawById.values()).sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    ),
    lastUpdateTime: Math.max(
      local.lastUpdateTime ?? 0,
      remote.lastUpdateTime ?? 0,
    ),
  } satisfies SdBackupState;
}

function mergeMcpState(
  localState: McpBackupState,
  remoteState: McpBackupState,
) {
  const local = normalizeMcpState(localState);
  const remote = normalizeMcpState(remoteState);

  return remote.updatedAt > local.updatedAt ? remote : local;
}

async function getMcpBackupState() {
  const localState = readMcpBackupStateFromStorage();
  if (localState) {
    return localState;
  }

  try {
    const res = await fetch(MCP_CONFIG_API_PATH, {
      method: "GET",
    });

    if (!res.ok) {
      return deepCopy(createDefaultBackupPayload().mcp);
    }

    const raw = await res.json();
    assertSafeJsonValue(raw);
    return normalizeMcpState(raw as Partial<McpBackupState>);
  } catch {
    return deepCopy(createDefaultBackupPayload().mcp);
  }
}

async function setMcpBackupState(state: McpBackupState) {
  const normalizedState = normalizeMcpState(state);
  writeMcpBackupStateToStorage(normalizedState);

  if (typeof window !== "undefined") {
    return;
  }

  try {
    const res = await fetch(MCP_CONFIG_API_PATH, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(normalizedState),
    });

    if (!res.ok) {
      throw new Error(`Failed to restore MCP config: ${res.status}`);
    }
  } catch (error) {
    if (Object.keys(normalizedState.config.mcpServers).length === 0) {
      console.warn("[Sync] skip empty MCP config restore", error);
      return;
    }

    throw error;
  }
}

function getChatStoreUpdateTime(state: ChatBackupState) {
  const lastSessionUpdate = state.sessions.reduce(
    (latest, session) => Math.max(latest, session.lastUpdate ?? 0),
    0,
  );
  const lastDeletionUpdate = Object.values(state.deletedSessions).reduce(
    (latest, deletedAt) => Math.max(latest, deletedAt ?? 0),
    0,
  );

  return Math.max(lastSessionUpdate, lastDeletionUpdate);
}

export async function getLocalAppState() {
  const chatState = getNonFunctionFileds(useChatStore.getState());
  const accessState = getNonFunctionFileds(useAccessStore.getState());
  const { validatedAccessCode: _validatedAccessCode, ...accessBackupState } =
    accessState;
  const configState = getNonFunctionFileds(useAppConfig.getState());
  const maskState = getNonFunctionFileds(useMaskStore.getState());
  const promptState = getNonFunctionFileds(usePromptStore.getState());
  const pluginState = getNonFunctionFileds(usePluginStore.getState());
  const sdState = getNonFunctionFileds(useSdStore.getState());

  return normalizeBackupPayload({
    chat: {
      sessions: deepCopy(chatState.sessions),
      deletedSessions: deepCopy(chatState.deletedSessions ?? {}),
    },
    access: {
      ...createDefaultAccessBackupState(),
      ...accessBackupState,
    },
    config: {
      ...configState,
    },
    mask: {
      masks: deepCopy(maskState.masks),
      language: maskState.language,
      lastUpdateTime: maskState.lastUpdateTime,
    },
    prompt: {
      counter: promptState.counter,
      prompts: deepCopy(promptState.prompts),
      lastUpdateTime: promptState.lastUpdateTime,
    },
    plugin: {
      plugins: deepCopy(pluginState.plugins),
      lastUpdateTime: pluginState.lastUpdateTime,
    },
    sd: {
      currentId: sdState.currentId,
      draw: deepCopy(sdState.draw),
      currentModel: deepCopy(sdState.currentModel),
      currentParams: deepCopy(sdState.currentParams),
      lastUpdateTime: sdState.lastUpdateTime,
    },
    mcp: await getMcpBackupState(),
  });
}

export async function setLocalAppState(appState: BackupPayload) {
  const normalized = normalizeBackupPayload(appState);
  const userPrompts = Object.values(normalized.prompt.prompts);
  const plugins = Object.values(normalized.plugin.plugins);
  const currentAccessState = useAccessStore.getState();
  const currentAccessCode = currentAccessState.accessCode.trim();
  const currentValidatedAccessCode =
    currentAccessState.validatedAccessCode.trim();
  const nextAccessCode = normalized.access.accessCode.trim();
  const shouldPreserveValidatedAccessCode =
    currentValidatedAccessCode.length > 0 &&
    currentValidatedAccessCode === currentAccessCode &&
    currentAccessCode === nextAccessCode;

  useChatStore.setState({
    sessions: normalized.chat.sessions,
    deletedSessions: normalized.chat.deletedSessions,
    currentSessionIndex: 0,
    lastInput: "",
    lastUpdateTime: getChatStoreUpdateTime(normalized.chat),
  });
  useAccessStore.setState({
    ...normalized.access,
    validatedAccessCode: shouldPreserveValidatedAccessCode
      ? nextAccessCode
      : "",
  });
  useAppConfig.setState(normalized.config);
  useMaskStore.setState(normalized.mask);
  usePromptStore.setState(normalized.prompt);
  usePluginStore.setState(normalized.plugin);
  useSdStore.setState(normalized.sd);

  SearchService.userEngine.setCollection(userPrompts);
  SearchService.allPrompts = userPrompts.concat(SearchService.builtinPrompts);

  FunctionToolService.tools = {};
  plugins.forEach((plugin) => {
    try {
      FunctionToolService.add(plugin, true);
    } catch (error) {
      console.error("[Sync] failed to rebuild plugin tool", plugin.id, error);
    }
  });

  await setMcpBackupState(normalized.mcp);
}

export function mergeAppState(
  localState: BackupPayload,
  remoteState: BackupPayload,
) {
  const local = normalizeBackupPayload(localState);
  const remote = normalizeBackupPayload(remoteState);

  return {
    chat: mergeChatState(local.chat, remote.chat),
    access: mergeWithUpdate(local.access, remote.access),
    config: mergeWithUpdate(local.config, remote.config),
    mask: mergeMaskState(local.mask, remote.mask),
    prompt: mergePromptState(local.prompt, remote.prompt),
    plugin: mergePluginState(local.plugin, remote.plugin),
    sd: mergeSdState(local.sd, remote.sd),
    mcp: mergeMcpState(local.mcp, remote.mcp),
  } satisfies BackupPayload;
}

export function getSyncAppState(appState: BackupPayload) {
  const syncState = normalizeBackupPayload(deepCopy(appState));

  syncState.chat.sessions = syncState.chat.sessions.filter(
    (session) => !syncState.chat.deletedSessions[session.id],
  );

  return syncState;
}

export function createBackupEnvelope(
  payload: BackupPayload,
  revision: string = nanoid(),
) {
  const normalizedPayload = getSyncAppState(payload);
  const envelope = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    revision,
    updatedAt: Date.now(),
    hash: hashPayload(normalizedPayload),
    payload: normalizedPayload,
  } satisfies BackupEnvelopeV2;

  return {
    envelope,
    content: JSON.stringify(envelope),
  };
}

export function parseBackupContent(rawContent: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new BackupValidationError("Backup is not valid JSON");
  }

  assertSafeJsonValue(parsed);

  if (isBackupEnvelopeV2(parsed)) {
    const payload = normalizeBackupPayload(parsed.payload);
    const expectedHash = hashPayload(payload);

    if (parsed.hash !== expectedHash) {
      throw new BackupValidationError("Backup checksum mismatch");
    }

    return {
      ...parsed,
      payload,
    } satisfies BackupEnvelopeV2;
  }

  if (looksLikeLegacyAppState(parsed)) {
    const payload = normalizeLegacyPayload(parsed);
    const { envelope } = createBackupEnvelope(payload, "legacy-import");
    return envelope;
  }

  throw new BackupValidationError("Unsupported backup schema");
}

/**
 * Merge state with `lastUpdateTime`, older state will be override.
 */
export function mergeWithUpdate<T extends { lastUpdateTime?: number }>(
  localState: T,
  remoteState: T,
) {
  const localUpdateTime = localState.lastUpdateTime ?? 0;
  const remoteUpdateTime = remoteState.lastUpdateTime ?? 0;

  if (localUpdateTime < remoteUpdateTime) {
    const mergedState = deepCopy(localState);
    merge(mergedState, remoteState);
    return mergedState;
  }

  const mergedState = deepCopy(remoteState);
  merge(mergedState, localState);
  return mergedState;
}
