type TTSPlayerCallbacks = {
  onEnded?: () => void;
  onError?: (error: Error) => void;
};

type TTSPlayer = {
  init: (callbacks?: TTSPlayerCallbacks) => void;
  enqueue: (audioBuffer: ArrayBuffer) => void;
  finish: () => void;
  play: (
    audioBuffer: ArrayBuffer,
    onended?: () => void | null,
  ) => Promise<void>;
  stop: () => void;
};

export function createTTSPlayer(): TTSPlayer {
  let audioElement: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let queue: ArrayBuffer[] = [];
  let finished = false;
  let playing = false;
  let callbacks: TTSPlayerCallbacks = {};
  let playbackToken = 0;

  const revokeObjectUrl = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const cleanupAudioElement = () => {
    if (audioElement) {
      audioElement.pause();
      audioElement.onended = null;
      audioElement.onerror = null;
      audioElement.src = "";
      audioElement.load();
      audioElement = null;
    }

    revokeObjectUrl();
  };

  const normalizeError = (error: unknown) => {
    return error instanceof Error ? error : new Error(String(error));
  };

  const resetState = () => {
    queue = [];
    finished = false;
    playing = false;
  };

  const stop = () => {
    playbackToken += 1;
    callbacks = {};
    resetState();
    cleanupAudioElement();
  };

  const emitEndedIfDone = () => {
    if (playing || queue.length > 0 || !finished) {
      return;
    }

    callbacks.onEnded?.();
  };

  const emitError = (token: number, error: unknown) => {
    if (token !== playbackToken) {
      return;
    }

    const onError = callbacks.onError;
    resetState();
    cleanupAudioElement();
    onError?.(normalizeError(error));
  };

  const playNext = () => {
    const token = playbackToken;

    if (playing) {
      return;
    }

    if (queue.length === 0) {
      emitEndedIfDone();
      return;
    }

    const nextBuffer = queue.shift();

    if (!nextBuffer) {
      emitEndedIfDone();
      return;
    }

    cleanupAudioElement();

    objectUrl = URL.createObjectURL(
      new Blob([nextBuffer], { type: "audio/mpeg" }),
    );

    const currentAudio = new Audio(objectUrl);
    currentAudio.preload = "auto";
    audioElement = currentAudio;
    playing = true;

    currentAudio.onended = () => {
      if (token !== playbackToken) {
        return;
      }

      playing = false;
      cleanupAudioElement();
      playNext();
    };

    currentAudio.onerror = () => {
      const mediaErrorCode = currentAudio.error?.code;
      emitError(
        token,
        new Error(
          mediaErrorCode
            ? `Failed to play the generated audio (media error ${mediaErrorCode})`
            : "Failed to play the generated audio",
        ),
      );
    };

    currentAudio.play().catch((error) => {
      emitError(token, error);
    });
  };

  const init = (nextCallbacks: TTSPlayerCallbacks = {}) => {
    playbackToken += 1;
    callbacks = nextCallbacks;
    resetState();
    cleanupAudioElement();
  };

  const enqueue = (audioBuffer: ArrayBuffer) => {
    queue.push(audioBuffer);
    playNext();
  };

  const finish = () => {
    finished = true;
    emitEndedIfDone();
  };

  const play = async (
    audioBuffer: ArrayBuffer,
    onended?: () => void | null,
  ) => {
    init();

    objectUrl = URL.createObjectURL(
      new Blob([audioBuffer], { type: "audio/mpeg" }),
    );

    const currentAudio = new Audio(objectUrl);
    currentAudio.preload = "auto";
    audioElement = currentAudio;
    playing = true;

    const token = playbackToken;

    await new Promise<void>((resolve, reject) => {
      currentAudio.onended = () => {
        if (token !== playbackToken) {
          return;
        }

        playing = false;
        onended?.();
        cleanupAudioElement();
      };

      currentAudio.onerror = () => {
        if (token !== playbackToken) {
          return;
        }

        playing = false;
        const mediaErrorCode = currentAudio.error?.code;
        cleanupAudioElement();
        reject(
          new Error(
            mediaErrorCode
              ? `Failed to play the generated audio (media error ${mediaErrorCode})`
              : "Failed to play the generated audio",
          ),
        );
      };

      currentAudio.play().then(resolve).catch((error) => {
        if (token !== playbackToken) {
          return;
        }

        playing = false;
        cleanupAudioElement();
        reject(normalizeError(error));
      });
    });
  };

  return { init, enqueue, finish, play, stop };
}
