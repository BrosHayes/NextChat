import {
  SyncConflictError,
  SyncTransportError,
  SyncWriteInput,
} from "./index";
import { STORAGE_KEY } from "@/app/constant";
import { SyncStore } from "@/app/store/sync";

export type WebDAVConfig = SyncStore["webdav"];
export type WebDavClient = ReturnType<typeof createWebDavClient>;

export function createWebDavClient(store: SyncStore) {
  const folder = STORAGE_KEY;
  const fileName = `${folder}/backup.json`;
  const config = store.webdav;
  const proxyUrl =
    store.useProxy && store.proxyUrl.length > 0 ? store.proxyUrl : undefined;

  return {
    async check() {
      try {
        const res = await fetch(this.path(folder, proxyUrl, "MKCOL"), {
          method: "GET",
          headers: this.headers(),
        });
        const success = [201, 200, 404, 405, 301, 302, 307, 308].includes(
          res.status,
        );
        console.log(
          `[WebDav] check ${success ? "success" : "failed"}, ${res.status} ${
            res.statusText
          }`,
        );
        return success;
      } catch (e) {
        console.error("[WebDav] failed to check", e);
      }

      return false;
    },

    async get(key: string) {
      const res = await fetch(this.path(fileName, proxyUrl), {
        method: "GET",
        headers: this.headers(),
      });

      console.log("[WebDav] get key = ", key, res.status, res.statusText);

      if (res.status === 404) {
        return {
          body: "",
          revision: null,
        };
      }

      if (!res.ok) {
        throw new SyncTransportError(
          `Failed to read WebDAV backup: ${res.status}`,
        );
      }

      return {
        body: await res.text(),
        revision: res.headers.get("etag"),
      };
    },

    async set(key: string, value: SyncWriteInput) {
      const headers = this.headers();

      headers["content-type"] = "application/json";
      if (value.expectedRevision) {
        headers["if-match"] = value.expectedRevision;
      } else {
        headers["if-none-match"] = "*";
      }

      const res = await fetch(this.path(fileName, proxyUrl), {
        method: "PUT",
        headers,
        body: value.body,
      });

      console.log("[WebDav] set key = ", key, res.status, res.statusText);

      if (res.status === 412) {
        throw new SyncConflictError("Remote WebDAV backup changed");
      }

      if (!res.ok) {
        throw new SyncTransportError(
          `Failed to write WebDAV backup: ${res.status}`,
        );
      }

      return res.headers.get("etag");
    },

    async clear(key: string) {
      const res = await fetch(this.path(fileName, proxyUrl, "DELETE"), {
        method: "DELETE",
        headers: this.headers(),
      });

      if (!res.ok && res.status !== 404) {
        throw new SyncTransportError(`Failed to clear WebDAV backup: ${res.status}`);
      }

      console.log("[WebDav] clear key = ", key, res.status, res.statusText);
    },

    headers() {
      const auth = btoa(config.username + ":" + config.password);

      return {
        authorization: `Basic ${auth}`,
      } as Record<string, string>;
    },
    path(path: string, proxyUrl: string = "", proxyMethod: string = "") {
      if (path.startsWith("/")) {
        path = path.slice(1);
      }

      if (proxyUrl.endsWith("/")) {
        proxyUrl = proxyUrl.slice(0, -1);
      }

      let url;
      const pathPrefix = "/api/webdav/";

      try {
        const u = new URL(proxyUrl + pathPrefix + path);
        u.searchParams.append("endpoint", config.endpoint);
        proxyMethod && u.searchParams.append("proxy_method", proxyMethod);
        url = u.toString();
      } catch (e) {
        url = pathPrefix + path + "?endpoint=" + config.endpoint;
        if (proxyMethod) {
          url += "&proxy_method=" + proxyMethod;
        }
      }

      return url;
    },
  };
}
