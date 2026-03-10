import { getDisplayImageUrl } from "../app/utils";

describe("getDisplayImageUrl", () => {
  test("keeps same-origin cache urls direct so service worker can serve them", () => {
    const cacheUrl = new URL("/api/cache/image.png", window.location.origin);

    expect(getDisplayImageUrl(cacheUrl.toString())).toBe("/api/cache/image.png");
  });

  test("proxies external image urls through the image route", () => {
    const imageUrl = "https://example.com/image.png";

    expect(getDisplayImageUrl(imageUrl)).toBe(
      `/api/image?url=${encodeURIComponent(imageUrl)}`,
    );
  });
});
