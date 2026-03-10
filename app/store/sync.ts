import { getClientConfig } from "../config/client";
import {
  ApiPath,
  RUNTIME_CONFIG_DOM,
  STORAGE_KEY,
  StoreKey,
} from "../constant";
import { createPersistStore } from "../utils/store";
import { useAccessStore } from "./access";
import {
  BackupValidationError,
  createBackupEnvelope,
  getLocalAppState,
  GetStoreState,
  mergeAppState,
  parseBackupContent,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import {
  createSyncClient,
  ProviderType,
  SyncConflictError,
  SyncTransportError,
} from "../utils/cloud";

export interface WebDavConfig {
  endpoint: string;
  username: string;
  password: string;
}

export class SyncAccessRequiredError extends Error {
  constructor() {
    super("A verified access code is required before using sync");
    this.name = "SyncAccessRequiredError";
  }
}

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;

type RuntimeConfig = {
  syncWebdav?: Partial<WebDavConfig>;
};

function getRuntimeConfig(): RuntimeConfig {
  if (typeof document === "undefined") {
    return {};
  }

  try {
    const meta = document.head.querySelector(
      `meta[name='${RUNTIME_CONFIG_DOM}']`,
    ) as HTMLMetaElement | null;

    return JSON.parse(meta?.content ?? "{}") as RuntimeConfig;
  } catch (error) {
    console.error("[Runtime Config] failed to parse", error);
    return {};
  }
}

function getDefaultWebDavConfig(): WebDavConfig {
  const config = getRuntimeConfig().syncWebdav;

  return {
    endpoint: config?.endpoint ?? "",
    username: config?.username ?? "",
    password: config?.password ?? "",
  };
}

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.WebDAV,
  useProxy: true,
  proxyUrl: ApiPath.Cors as string,

  webdav: getDefaultWebDavConfig(),

  upstash: {
    endpoint: "",
    username: STORAGE_KEY,
    apiKey: "",
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => ({
    cloudSync() {
      const config = get()[get().provider];
      return Object.values(config).every((c) => c.toString().length > 0);
    },

    markSyncTime() {
      set({ lastSyncTime: Date.now(), lastProvider: get().provider });
    },

    resetSyncTime() {
      set({ lastSyncTime: 0, lastProvider: "" });
    },

    getErrorMessage(
      error: unknown,
      fallback: string = Locale.Settings.Sync.Fail,
    ) {
      if (error instanceof BackupValidationError) {
        return Locale.Settings.Sync.InvalidBackup;
      }

      if (error instanceof SyncAccessRequiredError) {
        return Locale.Settings.Sync.RequiresAccessCode;
      }

      if (error instanceof SyncConflictError) {
        return Locale.Settings.Sync.Conflict;
      }

      if (error instanceof SyncTransportError) {
        return Locale.Settings.Sync.TransportError;
      }

      return fallback;
    },

    async ensureAuthorized() {
      const accessStore = useAccessStore.getState();

      if (!accessStore.enabledAccessControl()) {
        return;
      }

      if (accessStore.hasValidAccessCode()) {
        return;
      }

      await accessStore.verifyAccessCode();
      const latestAccessStore = useAccessStore.getState();

      if (
        latestAccessStore.enabledAccessControl() &&
        !latestAccessStore.hasValidAccessCode()
      ) {
        throw new SyncAccessRequiredError();
      }
    },

    async export() {
      await this.ensureAuthorized();
      const state = await getLocalAppState();
      const { content } = createBackupEnvelope(state);
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString();

      const fileName = `Backup-${datePart}.json`;
      downloadAs(content, fileName);
    },

    async import() {
      try {
        await this.ensureAuthorized();
        const rawContent = await readFromFile();
        const remoteState = parseBackupContent(rawContent);
        await setLocalAppState(remoteState.payload);
        showToast(Locale.Settings.Sync.ImportSuccess);
      } catch (error) {
        console.error("[Import]", error);
        showToast(
          this.getErrorMessage(error, Locale.Settings.Sync.ImportFailed),
        );
      }
    },

    getClient() {
      const provider = get().provider;
      return createSyncClient(provider, get());
    },

    async sync() {
      await this.ensureAuthorized();
      const localState = await getLocalAppState();
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient();
      const remoteState = await client.get(config.username);

      if (remoteState.body.trim().length === 0) {
        const { envelope, content } = createBackupEnvelope(localState);
        await client.set(config.username, {
          body: content,
          expectedRevision: remoteState.revision,
          nextRevision: envelope.revision,
        });
        this.markSyncTime();
        return;
      }

      const parsedRemoteState = parseBackupContent(remoteState.body);
      const mergedState = mergeAppState(localState, parsedRemoteState.payload);
      const { envelope, content } = createBackupEnvelope(mergedState);

      await client.set(config.username, {
        body: content,
        expectedRevision: remoteState.revision,
        nextRevision: envelope.revision,
      });
      await setLocalAppState(mergedState);

      this.markSyncTime();
    },

    async clearBackup() {
      await this.ensureAuthorized();
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient();

      await client.clear(config.username);
      this.resetSyncTime();
    },

    async check() {
      await this.ensureAuthorized();
      const client = this.getClient();
      return await client.check();
    },
  }),
  {
    name: StoreKey.Sync,
    version: 1.3,

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (version < 1.1) {
        newState.upstash.username = STORAGE_KEY;
      }

      if (version < 1.2) {
        if (
          (persistedState as typeof DEFAULT_SYNC_STATE).proxyUrl ===
          "/api/cors/"
        ) {
          newState.proxyUrl = "";
        }
      }

      if (version < 1.3) {
        const defaultWebdav = getDefaultWebDavConfig();
        newState.webdav = {
          endpoint: newState.webdav?.endpoint || defaultWebdav.endpoint,
          username: newState.webdav?.username || defaultWebdav.username,
          password: newState.webdav?.password || defaultWebdav.password,
        };
      }

      return newState as any;
    },
  },
);
