import { describe, expect, it } from "vitest";
import { buildShopifyThemeEditorUrl } from "@/lib/shopifyThemeEditor";

describe("buildShopifyThemeEditorUrl", () => {
  it("builds admin theme editor URL from myshopify.com domain", () => {
    expect(buildShopifyThemeEditorUrl("my-store.myshopify.com")).toBe(
      "https://admin.shopify.com/store/my-store/themes",
    );
  });

  it("normalizes casing and whitespace", () => {
    expect(buildShopifyThemeEditorUrl("  My-Store.MyShopify.com  ")).toBe(
      "https://admin.shopify.com/store/my-store/themes",
    );
  });

  it("returns null for missing or invalid domains", () => {
    expect(buildShopifyThemeEditorUrl(null)).toBeNull();
    expect(buildShopifyThemeEditorUrl("")).toBeNull();
    expect(buildShopifyThemeEditorUrl("not-a-shop-domain.com")).toBeNull();
    expect(buildShopifyThemeEditorUrl("my-store")).toBeNull();
  });
});
