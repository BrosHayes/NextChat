import { createWebDavClient } from "./webdav";
import { createUpstashClient } from "./upstash";

export enum ProviderType {
  WebDAV = "webdav",
  UpStash = "upstash",
}

export const SyncClients = {
  [ProviderType.UpStash]: createUpstashClient,
  [ProviderType.WebDAV]: createWebDavClient,
} as const;

type SyncClientConfig = {
  [K in keyof typeof SyncClients]: (typeof SyncClients)[K] extends (
    _: infer C,
  ) => any
    ? C
    : never;
};

export class SyncConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncConflictError";
  }
}

export class SyncTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncTransportError";
  }
}

export type SyncReadResult = {
  body: string;
  revision: string | null;
};

export type SyncWriteInput = {
  body: string;
  expectedRevision?: string | null;
  nextRevision?: string;
};

export type SyncClient = {
  get: (key: string) => Promise<SyncReadResult>;
  set: (key: string, value: SyncWriteInput) => Promise<string | null>;
  clear: (key: string) => Promise<void>;
  check: () => Promise<boolean>;
};

export function createSyncClient<T extends ProviderType>(
  provider: T,
  config: SyncClientConfig[T],
): SyncClient {
  return SyncClients[provider](config as any) as any;
}
