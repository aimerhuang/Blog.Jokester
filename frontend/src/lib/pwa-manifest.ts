import type { SiteConfigData } from "@/types/site-config";
import { resolveSeoSiteInfo } from "@/lib/seo";
import { parseAppearanceTokensJson } from "@/lib/theme/appearance-resolve";

const DEFAULT_THEME_COLOR = "#163bf2";
const DEFAULT_BACKGROUND_COLOR = "#f7f9fe";
const DEFAULT_ICON_192 = "/static/img/logo-192x192.png";
const DEFAULT_ICON_512 = "/static/img/logo-512x512.png";

export const PWA_MANIFEST_HEADERS = {
  "Content-Type": "application/manifest+json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveManifestShortName(name: string): string {
  const compact = name.replace(/\s+/g, "").trim();
  return compact.length > 12 ? compact.slice(0, 12) : compact;
}

function resolveThemeColor(tokens: unknown): string {
  const parsed = parseAppearanceTokensJson(tokens);
  const primary = parsed.light?.primary;
  return isNonEmptyString(primary) ? primary : DEFAULT_THEME_COLOR;
}

export function buildPwaManifest(siteConfig?: SiteConfigData | null) {
  const site = resolveSeoSiteInfo(siteConfig);
  const icon192 =
    (isNonEmptyString(siteConfig?.LOGO_URL_192x192) && siteConfig.LOGO_URL_192x192) ||
    (isNonEmptyString(siteConfig?.LOGO_URL) && siteConfig.LOGO_URL) ||
    DEFAULT_ICON_192;
  const icon512 =
    (isNonEmptyString(siteConfig?.LOGO_URL_512x512) && siteConfig.LOGO_URL_512x512) ||
    (isNonEmptyString(siteConfig?.LOGO_URL) && siteConfig.LOGO_URL) ||
    DEFAULT_ICON_512;

  return {
    name: site.siteName,
    short_name: resolveManifestShortName(site.siteName),
    description: site.description,
    start_url: "/",
    display: "standalone",
    background_color: DEFAULT_BACKGROUND_COLOR,
    theme_color: resolveThemeColor(siteConfig?.APPEARANCE_TOKENS),
    icons: [
      {
        src: icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
}
