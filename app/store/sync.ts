import { getClientConfig } from "../config/client";
import { ApiPath, RUNTIME_CONFIG_DOM, STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  getLocalAppState,
  getSyncAppState,
  GetStoreState,
  mergeAppState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";

export interface WebDavConfig {
  endpoint: string;
  username: string;
  password: string;
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

    export() {
      const state = getLocalAppState();
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString();

      const fileName = `Backup-${datePart}.json`;
      downloadAs(JSON.stringify(state), fileName);
    },

    async import() {
      const rawContent = await readFromFile();

      try {
        const remoteState = JSON.parse(rawContent) as AppState;
        const localState = getLocalAppState();
        mergeAppState(localState, remoteState);
        setLocalAppState(localState);
        location.reload();
      } catch (e) {
        console.error("[Import]", e);
        showToast(Locale.Settings.Sync.ImportFailed);
      }
    },

    getClient() {
      const provider = get().provider;
      const client = createSyncClient(provider, get());
      return client;
    },

    async sync() {
      const localState = getLocalAppState();
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient();

      try {
        const remoteState = await client.get(config.username);
        if (!remoteState || remoteState === "") {
          const syncState = getSyncAppState(localState);
          await client.set(config.username, JSON.stringify(syncState));
          this.markSyncTime();
          console.log(
            "[Sync] Remote state is empty, using local state instead.",
          );
          return;
        } else {
          const parsedRemoteState = JSON.parse(
            await client.get(config.username),
          ) as AppState;
          mergeAppState(localState, parsedRemoteState);
          setLocalAppState(localState);
        }
      } catch (e) {
        console.log("[Sync] failed to get remote state", e);
        throw e;
      }

      const syncState = getSyncAppState(localState);
      await client.set(config.username, JSON.stringify(syncState));

      this.markSyncTime();
    },

    async clearBackup() {
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient();

      await client.clear(config.username);
      this.resetSyncTime();
    },

    async check() {
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
