export type TTSAudioCacheKeyOptions = {
  engine: string;
  model?: string;
  voice: string;
  speed?: number;
  input: string;
  cacheBust?: string | number;
};

type TTSAudioCacheOptions = {
  maxEntries?: number;
  maxBytes?: number;
};

type TTSAudioCacheEntry = {
  audioBuffer: ArrayBuffer;
  size: number;
};

const DEFAULT_TTS_CACHE_MAX_ENTRIES = 128;
const DEFAULT_TTS_CACHE_MAX_BYTES = 32 * 1024 * 1024;

export function buildTTSAudioCacheKey(options: TTSAudioCacheKeyOptions) {
  return JSON.stringify({
    engine: options.engine,
    model: options.model ?? "",
    voice: options.voice,
    speed: options.speed ?? 1,
    input: options.input.trim(),
    cacheBust: options.cacheBust ?? "",
  });
}

export function createTTSAudioCache(options: TTSAudioCacheOptions = {}) {
  const maxEntries = options.maxEntries ?? DEFAULT_TTS_CACHE_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_TTS_CACHE_MAX_BYTES;
  const entries = new Map<string, TTSAudioCacheEntry>();
  const pending = new Map<string, Promise<ArrayBuffer>>();
  let totalBytes = 0;

  const touch = (key: string, entry: TTSAudioCacheEntry) => {
    entries.delete(key);
    entries.set(key, entry);
  };

  const evictIfNeeded = () => {
    while (entries.size > maxEntries || totalBytes > maxBytes) {
      const oldestKey = entries.keys().next().value as string | undefined;

      if (!oldestKey) {
        break;
      }

      const oldestEntry = entries.get(oldestKey);
      entries.delete(oldestKey);
      totalBytes -= oldestEntry?.size ?? 0;
    }
  };

  const get = (key: string) => {
    const entry = entries.get(key);

    if (!entry) {
      return undefined;
    }

    touch(key, entry);
    return entry.audioBuffer;
  };

  const set = (key: string, audioBuffer: ArrayBuffer) => {
    const existingEntry = entries.get(key);

    if (existingEntry) {
      totalBytes -= existingEntry.size;
      entries.delete(key);
    }

    entries.set(key, {
      audioBuffer,
      size: audioBuffer.byteLength,
    });
    totalBytes += audioBuffer.byteLength;
    evictIfNeeded();

    return entries.get(key)?.audioBuffer ?? audioBuffer;
  };

  const getOrCreate = async (
    key: string,
    loader: () => Promise<ArrayBuffer>,
  ) => {
    const cachedAudio = get(key);

    if (cachedAudio) {
      return cachedAudio;
    }

    const pendingAudio = pending.get(key);

    if (pendingAudio) {
      return pendingAudio;
    }

    const loadingPromise = loader()
      .then((audioBuffer) => set(key, audioBuffer))
      .finally(() => {
        pending.delete(key);
      });

    pending.set(key, loadingPromise);

    return loadingPromise;
  };

  const clear = () => {
    entries.clear();
    pending.clear();
    totalBytes = 0;
  };

  const stats = () => ({
    entries: entries.size,
    pending: pending.size,
    totalBytes,
  });

  return {
    clear,
    get,
    getOrCreate,
    set,
    stats,
  };
}

export const ttsAudioCache = createTTSAudioCache();
