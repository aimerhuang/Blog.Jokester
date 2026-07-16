import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("/manifest.json route", () => {
  it("returns a no-store manifest from public site configuration", async () => {
    vi.stubEnv("API_URL", "http://backend.test");
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            APP_NAME: "后台站点名称",
            SUB_TITLE: "后台副标题",
            SITE_DESCRIPTION: "后台站点描述",
            LOGO_URL_192x192: "/uploads/logo-192.png",
            LOGO_URL_512x512: "/uploads/logo-512.png",
            APPEARANCE_TOKENS: JSON.stringify({
              light: { primary: "#00aa88" },
            }),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as typeof fetch;

    const response = await GET();
    const manifest = await response.json();

    expect(global.fetch).toHaveBeenCalledWith("http://backend.test/api/public/site-config", {
      cache: "no-store",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response.headers.get("Content-Type")).toContain("application/manifest+json");
    expect(manifest).toMatchObject({
      name: "后台站点名称",
      short_name: "后台站点名称",
      description: "后台站点描述",
      theme_color: "#00aa88",
      icons: [
        {
          src: "/uploads/logo-192.png",
          sizes: "192x192",
        },
        {
          src: "/uploads/logo-512.png",
          sizes: "512x512",
        },
      ],
    });
  });
});
