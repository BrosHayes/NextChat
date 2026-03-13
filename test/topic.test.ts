import { normalizeGeneratedTopic } from "../app/utils/topic";

describe("normalizeGeneratedTopic", () => {
  test("limits space-delimited titles to ten words", () => {
    expect(
      normalizeGeneratedTopic(
        '"one two three four five six seven eight nine ten eleven."',
      ),
    ).toBe("one two three four five six seven eight nine ten");
  });

  test("limits non-space titles to ten characters", () => {
    expect(
      normalizeGeneratedTopic(
        "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u7532\u4e59",
      ),
    ).toBe(
      "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341",
    );
  });

  test("returns an empty string when nothing useful remains", () => {
    expect(normalizeGeneratedTopic('""')).toBe("");
  });
});
