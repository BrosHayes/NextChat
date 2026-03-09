import { nanoid } from "nanoid";
import { STORAGE_KEY } from "@/app/constant";
import { SyncStore } from "@/app/store/sync";
import { SyncConflictError, SyncTransportError } from "./index";

const HEAD_KEY_SUFFIX = "-head";
const LOCK_KEY_SUFFIX = "-lock";
const CHUNK_COUNT_SUFFIX = "-chunk-count";
const CHUNK_SUFFIX = "-chunk";
const LOCK_TTL_MS = 15_000;
const LOCK_RETRY_MS = 200;
const MAX_CHUNK_BYTES = 900_000;

export type UpstashConfig = SyncStore["upstash"];
export type UpStashClient = ReturnType<typeof createUpstashClient>;

type LockValue = {
  owner: string;
  expiresAt: number;
};

type HeadValue = {
  revision: string;
};

type PathSearchParams = Record<string, string | number | boolean>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonValue<T>(value: string | undefined) {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function* chunkUtf8String(input: string, maxBytes = MAX_CHUNK_BYTES) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
  });
  const bytes = encoder.encode(input);
  let start = 0;

  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);

    while (end > start) {
      try {
        const chunk = decoder.decode(bytes.slice(start, end));
        yield chunk;
        start = end;
        break;
      } catch {
        end -= 1;
      }
    }

    if (end === start) {
      throw new SyncTransportError("Failed to chunk UTF-8 payload safely");
    }
  }
}

export function createUpstashClient(store: SyncStore) {
  const config = store.upstash;
  const storeKey = config.username.length === 0 ? STORAGE_KEY : config.username;
  const headKey = `${storeKey}${HEAD_KEY_SUFFIX}`;
  const lockKey = `${storeKey}${LOCK_KEY_SUFFIX}`;
  const revisionPrefix = (revision: string) => `${storeKey}-rev-${revision}`;
  const chunkCountKey = (revision: string) =>
    `${revisionPrefix(revision)}${CHUNK_COUNT_SUFFIX}`;
  const chunkIndexKey = (revision: string, index: number) =>
    `${revisionPrefix(revision)}${CHUNK_SUFFIX}-${index}`;

  const proxyUrl =
    store.useProxy && store.proxyUrl.length > 0 ? store.proxyUrl : undefined;

  return {
    async check() {
      try {
        const res = await fetch(this.path(`get/${headKey}`, proxyUrl), {
          method: "GET",
          headers: this.headers(),
        });
        console.log("[Upstash] check", res.status, res.statusText);
        return [200].includes(res.status);
      } catch (e) {
        console.error("[Upstash] failed to check", e);
      }
      return false;
    },

    async redisGet(key: string) {
      const res = await fetch(this.path(`get/${key}`, proxyUrl), {
        method: "GET",
        headers: this.headers(),
      });

      console.log("[Upstash] get key = ", key, res.status, res.statusText);

      if (!res.ok) {
        throw new SyncTransportError(`Failed to read Upstash key: ${key}`);
      }

      const resJson = (await res.json()) as { result: string | null };

      return resJson.result ?? undefined;
    },

    async redisSet(
      key: string,
      value: string,
      searchParams?: PathSearchParams,
    ) {
      const res = await fetch(this.path(`set/${key}`, proxyUrl, searchParams), {
        method: "POST",
        headers: this.headers(),
        body: value,
      });

      console.log("[Upstash] set key = ", key, res.status, res.statusText);

      if (!res.ok) {
        throw new SyncTransportError(`Failed to write Upstash key: ${key}`);
      }

      const resJson = (await res.json()) as { result?: string | null };

      return resJson.result ?? null;
    },

    async redisDel(key: string) {
      const res = await fetch(this.path(`del/${key}`, proxyUrl), {
        method: "GET",
        headers: this.headers(),
      });

      if (!res.ok) {
        throw new SyncTransportError(`Failed to clear Upstash key: ${key}`);
      }

      console.log("[Upstash] del key = ", key, res.status, res.statusText);
    },

    async readHead() {
      return parseJsonValue<HeadValue>(await this.redisGet(headKey));
    },

    async writeRevision(revision: string, value: string) {
      let index = 0;

      for (const chunk of chunkUtf8String(value)) {
        await this.redisSet(chunkIndexKey(revision, index), chunk);
        index += 1;
      }

      await this.redisSet(chunkCountKey(revision), index.toString());
    },

    async deleteRevision(revision: string | null | undefined) {
      if (!revision) return;

      const chunkCount = Number(await this.redisGet(chunkCountKey(revision)));
      const tasks: Promise<void>[] = [];

      if (Number.isInteger(chunkCount) && chunkCount > 0) {
        for (let i = 0; i < chunkCount; i += 1) {
          tasks.push(this.redisDel(chunkIndexKey(revision, i)));
        }
      }

      tasks.push(this.redisDel(chunkCountKey(revision)));

      await Promise.all(tasks);
    },

    async acquireLock() {
      const owner = nanoid();
      const deadline = Date.now() + LOCK_TTL_MS;

      while (Date.now() < deadline) {
        const currentLockRaw = await this.redisGet(lockKey);
        const currentLock = parseJsonValue<LockValue>(currentLockRaw);

        if (
          typeof currentLockRaw === "string" &&
          (!currentLock || currentLock.expiresAt < Date.now())
        ) {
          await this.redisDel(lockKey);
        }

        const lockValue: LockValue = {
          owner,
          expiresAt: Date.now() + LOCK_TTL_MS,
        };
        const result = await this.redisSet(lockKey, JSON.stringify(lockValue), {
          NX: true,
          PX: LOCK_TTL_MS,
        });

        if (result === "OK") {
          return async () => {
            const latestLock = parseJsonValue<LockValue>(
              await this.redisGet(lockKey),
            );

            if (latestLock?.owner === owner) {
              await this.redisDel(lockKey);
            }
          };
        }

        await sleep(LOCK_RETRY_MS);
      }

      throw new SyncConflictError("Failed to acquire Upstash sync lock");
    },

    async get() {
      const head = await this.readHead();

      if (!head?.revision) {
        return {
          body: "",
          revision: null,
        };
      }

      const chunkCount = Number(await this.redisGet(chunkCountKey(head.revision)));
      if (!Number.isInteger(chunkCount) || chunkCount < 0) {
        throw new SyncTransportError("Corrupted Upstash chunk metadata");
      }

      const chunks = await Promise.all(
        new Array(chunkCount)
          .fill(0)
          .map((_, i) => this.redisGet(chunkIndexKey(head.revision, i))),
      );

      if (chunks.some((chunk) => typeof chunk !== "string")) {
        throw new SyncTransportError("Corrupted Upstash chunk payload");
      }

      return {
        body: chunks.join(""),
        revision: head.revision,
      };
    },

    async set(
      _: string,
      value: { body: string; expectedRevision?: string | null; nextRevision?: string },
    ) {
      const releaseLock = await this.acquireLock();

      try {
        const currentHead = await this.readHead();
        const currentRevision = currentHead?.revision ?? null;

        if (currentRevision !== (value.expectedRevision ?? null)) {
          throw new SyncConflictError("Remote Upstash backup changed");
        }

        const nextRevision = value.nextRevision ?? nanoid();
        await this.writeRevision(nextRevision, value.body);
        await this.redisSet(
          headKey,
          JSON.stringify({
            revision: nextRevision,
          } satisfies HeadValue),
        );
        await this.deleteRevision(currentRevision);

        return nextRevision;
      } finally {
        await releaseLock();
      }
    },

    async clear() {
      const releaseLock = await this.acquireLock();

      try {
        const currentHead = await this.readHead();
        await this.deleteRevision(currentHead?.revision);

        const currentLock = parseJsonValue<LockValue>(await this.redisGet(lockKey));
        if (currentLock) {
          await this.redisDel(lockKey);
        }

        const headValue = await this.redisGet(headKey);
        if (typeof headValue === "string") {
          await this.redisDel(headKey);
        }
      } finally {
        try {
          await releaseLock();
        } catch {
          // ignore release failure after clear
        }
      }
    },

    headers() {
      return {
        Authorization: `Bearer ${config.apiKey}`,
      };
    },
    path(
      path: string,
      proxyUrl: string = "",
      searchParams?: PathSearchParams,
    ) {
      if (!path.endsWith("/")) {
        path += "/";
      }
      if (path.startsWith("/")) {
        path = path.slice(1);
      }

      if (proxyUrl.length > 0 && !proxyUrl.endsWith("/")) {
        proxyUrl += "/";
      }

      let url;
      const pathPrefix = "/api/upstash/";

      try {
        const u = new URL(proxyUrl + pathPrefix + path);
        u.searchParams.append("endpoint", config.endpoint);
        Object.entries(searchParams ?? {}).forEach(([key, value]) => {
          u.searchParams.append(key, String(value));
        });
        url = u.toString();
      } catch (e) {
        const extraQuery = new URLSearchParams();
        extraQuery.append("endpoint", config.endpoint);
        Object.entries(searchParams ?? {}).forEach(([key, value]) => {
          extraQuery.append(key, String(value));
        });
        url = pathPrefix + path + "?" + extraQuery.toString();
      }

      return url;
    },
  };
}
