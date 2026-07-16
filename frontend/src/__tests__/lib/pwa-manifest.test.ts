import { describe, expect, it } from "vitest";
import { buildPwaManifest, resolveManifestShortName } from "@/lib/pwa-manifest";

describe("buildPwaManifest", () => {
  it("maps public site configuration into the PWA manifest", () => {
    const manifest = buildPwaManifest({
      APP_NAME: "后台站点名称",
      SUB_TITLE: "后台副标题",
      SITE_DESCRIPTION: "后台站点描述",
      LOGO_URL_192x192: "/uploads/logo-192.png",
      LOGO_URL_512x512: "/uploads/logo-512.png",
      APPEARANCE_TOKENS: {
        light: { primary: "#00aa88" },
      },
    });

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

  it("falls back to SUB_TITLE when SITE_DESCRIPTION is empty", () => {
    const manifest = buildPwaManifest({
      APP_NAME: "后台站点名称",
      SUB_TITLE: "后台副标题",
      SITE_DESCRIPTION: "",
    });

    expect(manifest.description).toBe("后台副标题");
  });
});

describe("resolveManifestShortName", () => {
  it("removes spaces and caps the short name to 12 characters", () => {
    expect(resolveManifestShortName("An He Yu Pro Site Name")).toBe("AnHeYuProSit");
  });
});
