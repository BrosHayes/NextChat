import { splitTextForTTS } from "../app/utils/tts";

describe("splitTextForTTS", () => {
  test("keeps paragraph boundaries when chunks are already short enough", () => {
    expect(
      splitTextForTTS(
        "\u7b2c\u4e00\u6bb5\u5185\u5bb9\u3002\n\n\u7b2c\u4e8c\u6bb5\u5185\u5bb9\u3002",
        {
          maxChunkLength: 20,
        },
      ),
    ).toEqual([
      "\u7b2c\u4e00\u6bb5\u5185\u5bb9\u3002",
      "\u7b2c\u4e8c\u6bb5\u5185\u5bb9\u3002",
    ]);
  });

  test("splits long paragraphs by sentence boundaries before hard cutting", () => {
    expect(
      splitTextForTTS(
        "\u7b2c\u4e00\u53e5\u3002\u7b2c\u4e8c\u53e5\u3002\u7b2c\u4e09\u53e5\u3002",
        {
          maxChunkLength: 8,
        },
      ),
    ).toEqual([
      "\u7b2c\u4e00\u53e5\u3002\u7b2c\u4e8c\u53e5\u3002",
      "\u7b2c\u4e09\u53e5\u3002",
    ]);
  });

  test("falls back to hard splitting when a sentence is still too long", () => {
    expect(
      splitTextForTTS("abcdefghijklmnopqrstuvwxyz", {
        maxChunkLength: 10,
      }),
    ).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
  });
});
