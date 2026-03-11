import { jest } from "@jest/globals";
import {
  buildTTSAudioCacheKey,
  createTTSAudioCache,
} from "../app/utils/tts-cache";

function createAudioBuffer(size: number) {
  return new Uint8Array(size).buffer;
}

describe("ttsAudioCache", () => {
  test("reuses cached audio for the same key", async () => {
    const cache = createTTSAudioCache();
    const key = buildTTSAudioCacheKey({
      engine: "openai",
      model: "tts-1",
      voice: "alloy",
      speed: 1,
      input: "hello world",
    });
    const loader = jest.fn(async () => createAudioBuffer(8));

    const first = await cache.getOrCreate(key, loader);
    const second = await cache.getOrCreate(key, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test("deduplicates concurrent loads for the same key", async () => {
    const cache = createTTSAudioCache();
    const key = buildTTSAudioCacheKey({
      engine: "edge",
      voice: "en-US-AriaNeural",
      speed: 1.2,
      input: "same chunk",
    });
    const loader = jest.fn(
      async () =>
        await new Promise<ArrayBuffer>((resolve) => {
          setTimeout(() => resolve(createAudioBuffer(16)), 0);
        }),
    );

    const [first, second] = await Promise.all([
      cache.getOrCreate(key, loader),
      cache.getOrCreate(key, loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test("evicts the least recently used entry when the cache is full", async () => {
    const cache = createTTSAudioCache({ maxEntries: 2 });
    const keyA = buildTTSAudioCacheKey({
      engine: "openai",
      voice: "alloy",
      input: "A",
    });
    const keyB = buildTTSAudioCacheKey({
      engine: "openai",
      voice: "alloy",
      input: "B",
    });
    const keyC = buildTTSAudioCacheKey({
      engine: "openai",
      voice: "alloy",
      input: "C",
    });

    await cache.getOrCreate(keyA, async () => createAudioBuffer(4));
    await cache.getOrCreate(keyB, async () => createAudioBuffer(4));

    await cache.getOrCreate(keyC, async () => createAudioBuffer(4));

    expect(cache.get(keyA)).toBeUndefined();
    expect(cache.get(keyB)).toBeDefined();
    expect(cache.get(keyC)).toBeDefined();
  });

  test("changes the cache key when a retry cache-bust token is present", () => {
    const baseOptions = {
      engine: "openai",
      model: "tts-1",
      voice: "alloy",
      speed: 1,
      input: "hello world",
    };

    const firstKey = buildTTSAudioCacheKey(baseOptions);
    const retriedKey = buildTTSAudioCacheKey({
      ...baseOptions,
      cacheBust: 1,
    });

    expect(retriedKey).not.toBe(firstKey);
  });
});
