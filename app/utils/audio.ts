type TTSPlayer = {
  init: () => void;
  play: (audioBuffer: ArrayBuffer, onended: () => void | null) => Promise<void>;
  stop: () => void;
};

export function createTTSPlayer(): TTSPlayer {
  let audioElement: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;

  const cleanup = () => {
    if (audioElement) {
      audioElement.pause();
      audioElement.onended = null;
      audioElement.onerror = null;
      audioElement.src = "";
      audioElement.load();
      audioElement = null;
    }

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const init = () => {
    cleanup();
  };

  const play = async (audioBuffer: ArrayBuffer, onended: () => void | null) => {
    cleanup();

    objectUrl = URL.createObjectURL(
      new Blob([audioBuffer], { type: "audio/mpeg" }),
    );
    const currentAudio = new Audio(objectUrl);
    currentAudio.preload = "auto";
    audioElement = currentAudio;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      currentAudio.onended = () => {
        onended?.();
        cleanup();
      };

      currentAudio.onerror = () => {
        const mediaErrorCode = currentAudio.error?.code;
        rejectOnce(
          new Error(
            mediaErrorCode
              ? `Failed to play the generated audio (media error ${mediaErrorCode})`
              : "Failed to play the generated audio",
          ),
        );
      };

      currentAudio.play().then(resolveOnce).catch(rejectOnce);
    });
  };

  const stop = () => {
    cleanup();
  };

  return { init, play, stop };
}
