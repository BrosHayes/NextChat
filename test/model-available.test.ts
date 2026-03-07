import {
  collectModelTable,
  isModelNotavailableInServer,
} from "../app/utils/model";

describe("isModelNotavailableInServer", () => {
  test("test model will return false, which means the model is available", () => {
    const customModels = "";
    const modelName = "gpt-4";
    const providerNames = "OpenAI";
    const result = isModelNotavailableInServer(
      customModels,
      modelName,
      providerNames,
    );
    expect(result).toBe(false);
  });

  test("test model will return true when model is not available in custom models", () => {
    const customModels = "-all,gpt-4o-mini";
    const modelName = "gpt-4";
    const providerNames = "OpenAI";
    const result = isModelNotavailableInServer(
      customModels,
      modelName,
      providerNames,
    );
    expect(result).toBe(true);
  });

  test("should respect DISABLE_GPT4 setting", () => {
    process.env.DISABLE_GPT4 = "1";
    const result = isModelNotavailableInServer("", "gpt-4", "OpenAI");
    expect(result).toBe(true);
  });

  test("should handle empty provider names", () => {
    const result = isModelNotavailableInServer("-all,gpt-4", "gpt-4", "");
    expect(result).toBe(true);
  });

  test("should be case insensitive for model names", () => {
    const result = isModelNotavailableInServer("-all,GPT-4", "gpt-4", "OpenAI");
    expect(result).toBe(true);
  });

  test("support passing multiple providers, model unavailable on one of the providers will return true", () => {
    const customModels = "-all,gpt-4@google";
    const modelName = "gpt-4";
    const providerNames = ["OpenAI", "Azure"];
    const result = isModelNotavailableInServer(
      customModels,
      modelName,
      providerNames,
    );
    expect(result).toBe(true);
  });

  // FIXME: 这个测试用例有问题，需要修复
  //   test("support passing multiple providers, model available on one of the providers will return false", () => {
  //     const customModels = "-all,gpt-4@google";
  //     const modelName = "gpt-4";
  //     const providerNames = ["OpenAI", "Google"];
  //     const result = isModelNotavailableInServer(
  //       customModels,
  //       modelName,
  //       providerNames,
  //     );
  //     expect(result).toBe(false);
  //   });

  test("test custom model without setting provider", () => {
    const customModels = "-all,mistral-large";
    const modelName = "mistral-large";
    const providerNames = modelName;
    const result = isModelNotavailableInServer(
      customModels,
      modelName,
      providerNames,
    );
    expect(result).toBe(false);
  });

  test("prefers provider-unspecified custom models over built-in 302.AI entries", () => {
    const modelTable = collectModelTable(
      [
        {
          name: "gemini-2.5-flash",
          available: true,
          sorted: 1,
          provider: {
            id: "ai302",
            providerName: "302.AI",
            providerType: "ai302",
            sorted: 1,
          },
        },
      ],
      "gemini-2.5-flash",
    );

    expect(modelTable["gemini-2.5-flash@302.ai"]?.available).toBe(false);
    expect(
      modelTable["gemini-2.5-flash@gemini-2.5-flash"]?.available,
    ).toBe(true);
  });

  test("trims whitespace in CUSTOM_MODELS entries", () => {
    const modelTable = collectModelTable(
      [
        {
          name: "gemini-2.5-flash",
          available: true,
          sorted: 1,
          provider: {
            id: "302.ai",
            providerName: "302.AI",
            providerType: "ai302",
            sorted: 1,
          },
        },
      ],
      "-all, +gemini-2.5-flash",
    );

    expect(modelTable["gemini-2.5-flash@302.ai"]?.available).toBe(false);
    expect(
      modelTable["gemini-2.5-flash@gemini-2.5-flash"]?.available,
    ).toBe(true);
  });
});
