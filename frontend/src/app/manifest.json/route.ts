import { NextResponse } from "next/server";
import { fetchSiteConfigForSeo } from "@/lib/seo";
import { buildPwaManifest, PWA_MANIFEST_HEADERS } from "@/lib/pwa-manifest";

export const dynamic = "force-dynamic";

export async function GET() {
  const siteConfig = await fetchSiteConfigForSeo();
  return NextResponse.json(buildPwaManifest(siteConfig), {
    headers: PWA_MANIFEST_HEADERS,
  });
}
