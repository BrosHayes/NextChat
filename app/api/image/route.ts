import { NextRequest, NextResponse } from "next/server";

const IMAGE_EXTENSION_REGEX =
  /\.(avif|bmp|gif|heic|heif|ico|jpe?g|jfif|pjpeg|pjp|png|svg|webp)$/i;

function canPreviewAsImage(url: URL, contentType: string | null) {
  if (!contentType) {
    return IMAGE_EXTENSION_REGEX.test(url.pathname);
  }

  const normalizedType = contentType.toLowerCase();
  return (
    normalizedType.startsWith("image/") ||
    (normalizedType.includes("application/octet-stream") &&
      IMAGE_EXTENSION_REGEX.test(url.pathname))
  );
}

function guessImageContentType(pathname: string) {
  const lowerPath = pathname.toLowerCase();
  if (lowerPath.endsWith(".png")) return "image/png";
  if (lowerPath.endsWith(".gif")) return "image/gif";
  if (lowerPath.endsWith(".webp")) return "image/webp";
  if (lowerPath.endsWith(".svg")) return "image/svg+xml";
  if (lowerPath.endsWith(".bmp")) return "image/bmp";
  if (lowerPath.endsWith(".avif")) return "image/avif";
  if (lowerPath.endsWith(".ico")) return "image/x-icon";
  if (lowerPath.endsWith(".heic")) return "image/heic";
  if (lowerPath.endsWith(".heif")) return "image/heif";
  return "image/jpeg";
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")?.trim();

  if (!rawUrl) {
    return NextResponse.json({ error: true, message: "Missing url" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: true, message: "Invalid url" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return NextResponse.json(
      { error: true, message: "Only http/https image urls are supported" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30 * 1000);

  try {
    const res = await fetch(targetUrl, {
      headers: {
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      return NextResponse.json(
        {
          error: true,
          message: `Upstream image request failed with status ${res.status}`,
        },
        { status: res.status || 502 },
      );
    }

    const contentType = res.headers.get("content-type");
    if (!canPreviewAsImage(targetUrl, contentType)) {
      return NextResponse.json(
        { error: true, message: "The upstream response is not an image" },
        { status: 415 },
      );
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      contentType || guessImageContentType(targetUrl.pathname),
    );
    headers.set("Content-Disposition", "inline");
    headers.set(
      "Cache-Control",
      res.headers.get("cache-control") || "public, max-age=3600, s-maxage=3600",
    );

    const etag = res.headers.get("etag");
    if (etag) headers.set("ETag", etag);

    const lastModified = res.headers.get("last-modified");
    if (lastModified) headers.set("Last-Modified", lastModified);

    return new Response(res.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const status = error instanceof Error && error.name === "AbortError" ? 504 : 502;
    const message =
      status === 504 ? "Image request timed out" : "Failed to fetch upstream image";

    return NextResponse.json({ error: true, message }, { status });
  } finally {
    clearTimeout(timeoutId);
  }
}
