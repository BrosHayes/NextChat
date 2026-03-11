import { jest } from "@jest/globals";
import { createTTSPlayer } from "../app/utils/audio";

function createAudioBuffer(size: number) {
  return new Uint8Array(size).buffer;
}

describe("createTTSPlayer", () => {
  const OriginalAudio = global.Audio;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  class FakeAudio {
    static instances: FakeAudio[] = [];

    public preload = "auto";
    public src = "";
    public onended: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public error: { code?: number } | null = null;

    constructor(src?: string) {
      this.src = src ?? "";
      FakeAudio.instances.push(this);
    }

    pause() {}

    load() {}

    play() {
      return Promise.resolve();
    }
  }

  beforeEach(() => {
    FakeAudio.instances = [];
    global.Audio = FakeAudio as unknown as typeof Audio;
    URL.createObjectURL = jest.fn(() => "blob:test");
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    global.Audio = OriginalAudio;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  test("tracks completion for each queued chunk in order", async () => {
    const player = createTTSPlayer();
    const completed: number[] = [];

    player.init({
      onEnded: () => completed.push(99),
    });

    player.enqueue(createAudioBuffer(4), () => completed.push(0));
    player.enqueue(createAudioBuffer(8), () => completed.push(1));
    player.finish();

    await Promise.resolve();
    expect(FakeAudio.instances).toHaveLength(1);

    FakeAudio.instances[0].onended?.();
    await Promise.resolve();

    expect(completed).toEqual([0]);
    expect(FakeAudio.instances).toHaveLength(2);

    FakeAudio.instances[1].onended?.();
    await Promise.resolve();

    expect(completed).toEqual([0, 1, 99]);
  });
});
