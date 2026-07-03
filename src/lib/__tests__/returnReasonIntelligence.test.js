import { describe, expect, it } from "vitest";
import {
  analyzeReturnReason,
  detectHighestPrecedenceMatch,
  normalizeExplicitReason,
  normalizeSearchText,
  normalizeStoreType,
} from "@/lib/returnReasonIntelligence";

function analyze(overrides = {}) {
  return analyzeReturnReason(overrides);
}

function expectOutputShape(result) {
  expect(result).toMatchObject({
    inputReason: expect.any(String),
    normalizedReason: expect.any(String),
    reasonGroup: expect.any(String),
    severity: expect.any(String),
    customerIntent: expect.any(String),
    recoveryOpportunity: expect.any(String),
    recommendedNextStep: expect.any(String),
    followUpNeeded: expect.any(Boolean),
    merchantInsightTags: expect.any(Array),
    confidence: expect.any(Number),
    storeType: expect.any(String),
    productContextTags: expect.any(Array),
    qualityIssueType: expect.any(String),
  });
}

describe("returnReasonIntelligence", () => {
  describe("known reason mappings", () => {
    it("wrong_size maps to fit_issue with exchange recommendation", () => {
      const result = analyze({ reason: "wrong_size" });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.reasonGroup).toBe("fit_issue");
      expect(result.recoveryOpportunity).toBe("high");
      expect(result.recommendedNextStep).toBe("offer_exchange_first");
      expect(result.qualityIssueType).toBe("not_quality_related");
      expect(result.confidence).toBe(0.95);
    });

    it("damaged_item maps to quality_issue with damage_issue default", () => {
      const result = analyze({ reason: "damaged_item" });

      expect(result.reasonGroup).toBe("quality_issue");
      expect(result.severity).toBe("high");
      expect(result.recommendedNextStep).toBe("manual_review_or_photo_check");
      expect(result.qualityIssueType).toBe("damage_issue");
      expect(result.confidence).toBe(0.95);
    });

    it("changed_mind maps to preference_issue", () => {
      const result = analyze({ reason: "changed_mind" });

      expect(result.normalizedReason).toBe("changed_mind");
      expect(result.reasonGroup).toBe("preference_issue");
      expect(result.customerIntent).toBe("store_credit_possible");
      expect(result.qualityIssueType).toBe("not_quality_related");
      expect(result.confidence).toBe(0.95);
    });

    it("late_delivery maps to fulfillment_issue", () => {
      const result = analyze({ reason: "late_delivery" });

      expect(result.normalizedReason).toBe("late_delivery");
      expect(result.reasonGroup).toBe("fulfillment_issue");
      expect(result.followUpNeeded).toBe(false);
      expect(result.confidence).toBe(0.95);
    });

    it("other maps to unclear", () => {
      const result = analyze({ reason: "other" });

      expect(result.normalizedReason).toBe("other");
      expect(result.reasonGroup).toBe("unclear");
      expect(result.confidence).toBe(0.55);
    });
  });

  describe("keyword normalization", () => {
    it("missing reason + comment too small normalizes to wrong_size", () => {
      const result = analyze({ comment: "too small" });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.confidence).toBe(0.8);
    });

    it("other + comment too tight normalizes to wrong_size", () => {
      const result = analyze({ reason: "other", comment: "too tight" });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.confidence).toBe(0.8);
    });

    it("other + comment arrived cracked normalizes to damaged_item and damage_issue", () => {
      const result = analyze({ reason: "other", comment: "arrived cracked" });

      expect(result.normalizedReason).toBe("damaged_item");
      expect(result.qualityIssueType).toBe("damage_issue");
    });

    it("other + comment changed my mind normalizes to changed_mind", () => {
      const result = analyze({ reason: "other", comment: "changed my mind" });

      expect(result.normalizedReason).toBe("changed_mind");
    });

    it("other + comment arrived too late normalizes to late_delivery", () => {
      const result = analyze({ reason: "other", comment: "arrived too late" });

      expect(result.normalizedReason).toBe("late_delivery");
    });
  });

  describe("string normalization helper", () => {
    it("normalizes curly apostrophes and whitespace", () => {
      expect(normalizeSearchText("  won’t   fit  ")).toBe("won't fit");
      expect(normalizeSearchText("doesn’t work")).toBe("doesn't work");
    });
  });

  describe("quality issue intelligence", () => {
    it("poor quality maps to material_quality_issue", () => {
      const result = analyze({ comment: "poor quality" });

      expect(result.normalizedReason).toBe("damaged_item");
      expect(result.reasonGroup).toBe("quality_issue");
      expect(result.qualityIssueType).toBe("material_quality_issue");
    });

    it("cheap material maps to material_quality_issue", () => {
      const result = analyze({ comment: "cheap material" });

      expect(result.qualityIssueType).toBe("material_quality_issue");
    });

    it("broke quickly maps to durability_issue", () => {
      const result = analyze({ comment: "broke quickly" });

      expect(result.qualityIssueType).toBe("durability_issue");
    });

    it("bad stitching maps to finish_issue", () => {
      const result = analyze({ comment: "bad stitching" });

      expect(result.qualityIssueType).toBe("finish_issue");
    });

    it("not working maps to defect_issue", () => {
      const result = analyze({ comment: "not working" });

      expect(result.qualityIssueType).toBe("defect_issue");
    });

    it("missing parts maps to missing_parts_issue", () => {
      const result = analyze({ comment: "missing parts" });

      expect(result.qualityIssueType).toBe("missing_parts_issue");
    });

    it("looks fake maps to authenticity_issue", () => {
      const result = analyze({ comment: "looks fake" });

      expect(result.qualityIssueType).toBe("authenticity_issue");
    });

    it("not as described maps to description_mismatch", () => {
      const result = analyze({ comment: "not as described" });

      expect(result.qualityIssueType).toBe("description_mismatch");
    });

    it("different from photos maps to description_mismatch", () => {
      const result = analyze({ comment: "different from photos" });

      expect(result.qualityIssueType).toBe("description_mismatch");
    });

    it("caused rash maps to safety_sensitive_issue with safety follow-up", () => {
      const result = analyze({ comment: "caused rash" });

      expect(result.qualityIssueType).toBe("safety_sensitive_issue");
      expect(result.recommendedNextStep).toBe("manual_review_or_safety_check");
      expect(result.followUpType).toBe("safety_details");
    });
  });

  describe("conflict and precedence", () => {
    it("faulty and looks fake chooses authenticity_issue", () => {
      const result = analyze({ comment: "faulty and looks fake" });

      expect(result.qualityIssueType).toBe("authenticity_issue");
    });

    it("missing parts and poor quality chooses missing_parts_issue", () => {
      const result = analyze({ comment: "missing parts and poor quality" });

      expect(result.qualityIssueType).toBe("missing_parts_issue");
    });

    it("not working and bad stitching chooses defect_issue", () => {
      const result = analyze({ comment: "not working and bad stitching" });

      expect(result.qualityIssueType).toBe("defect_issue");
    });

    it("looks different is description_mismatch not changed_mind", () => {
      const result = analyze({ comment: "looks different" });

      expect(result.qualityIssueType).toBe("description_mismatch");
      expect(result.normalizedReason).toBe("damaged_item");
    });

    it("not what I expected is description_mismatch", () => {
      const result = analyze({ comment: "not what I expected" });

      expect(result.qualityIssueType).toBe("description_mismatch");
    });

    it("wrong colour is preference_issue", () => {
      const result = analyze({ comment: "wrong colour" });

      expect(result.normalizedReason).toBe("changed_mind");
      expect(result.reasonGroup).toBe("preference_issue");
    });

    it("colour different from photos is description_mismatch", () => {
      const result = analyze({ comment: "colour different from photos" });

      expect(result.qualityIssueType).toBe("description_mismatch");
    });
  });

  describe("override behaviour", () => {
    it("changed_mind + arrived cracked normalizes to damaged_item with damage_issue", () => {
      const result = analyze({
        reason: "changed_mind",
        comment: "it arrived cracked",
      });

      expect(result.normalizedReason).toBe("damaged_item");
      expect(result.qualityIssueType).toBe("damage_issue");
      expect(result.confidence).toBe(0.8);
    });

    it("changed_mind + not working normalizes to defect_issue", () => {
      const result = analyze({
        reason: "changed_mind",
        comment: "not working",
      });

      expect(result.normalizedReason).toBe("damaged_item");
      expect(result.qualityIssueType).toBe("defect_issue");
    });

    it("other + not working normalizes to defect_issue", () => {
      const result = analyze({ reason: "other", comment: "not working" });

      expect(result.normalizedReason).toBe("damaged_item");
      expect(result.qualityIssueType).toBe("defect_issue");
    });

    it("changed_mind + not as described normalizes to description_mismatch", () => {
      const result = analyze({
        reason: "changed_mind",
        comment: "not as described",
      });

      expect(result.normalizedReason).toBe("damaged_item");
      expect(result.qualityIssueType).toBe("description_mismatch");
    });

    it("wrong_size + bad stitching keeps wrong_size", () => {
      const result = analyze({
        reason: "wrong_size",
        comment: "also the stitching is bad",
      });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.qualityIssueType).toBe("not_quality_related");
    });

    it("late_delivery + rash normalizes to safety_sensitive_issue", () => {
      const result = analyze({
        reason: "late_delivery",
        comment: "it caused rash",
      });

      expect(result.normalizedReason).toBe("damaged_item");
      expect(result.qualityIssueType).toBe("safety_sensitive_issue");
    });
  });

  describe("severity conflict", () => {
    it("damaged_item + bad stitching returns finish_issue with medium severity", () => {
      const result = analyze({
        reason: "damaged_item",
        comment: "bad stitching",
      });

      expect(result.qualityIssueType).toBe("finish_issue");
      expect(result.severity).toBe("medium");
      expect(result.confidence).toBe(0.95);
    });

    it("damaged_item + not working returns defect_issue with high severity", () => {
      const result = analyze({
        reason: "damaged_item",
        comment: "not working",
      });

      expect(result.qualityIssueType).toBe("defect_issue");
      expect(result.severity).toBe("high");
      expect(result.confidence).toBe(0.95);
    });
  });

  describe("safe fallback", () => {
    it("missing reason and comment returns unclear result", () => {
      const result = analyze();

      expect(result.normalizedReason).toBe("other");
      expect(result.reasonGroup).toBe("unclear");
      expect(result.confidence).toBe(0.55);
    });

    it("unknown reason returns unclear result", () => {
      const result = analyze({ reason: "totally_unknown_reason" });

      expect(result.normalizedReason).toBe("other");
      expect(result.confidence).toBe(0.55);
    });

    it("empty strings do not throw", () => {
      expect(() =>
        analyze({
          reason: "",
          comment: "",
          productTitle: "",
          productType: "",
          storeType: "",
        }),
      ).not.toThrow();
    });

    it("unknown storeType returns general", () => {
      const result = analyze({ storeType: "mystery_shop" });

      expect(result.storeType).toBe("general");
    });

    it("missing productType returns null", () => {
      const result = analyze({ productType: null });

      expect(result.productType).toBeNull();
    });

    it("productContextTags defaults to empty array", () => {
      const result = analyze({ reason: "wrong_size" });

      expect(result.productContextTags).toEqual([]);
    });

    it("merchantInsightTags is a stable duplicate-free array", () => {
      const result = analyze({
        reason: "damaged_item",
        comment: "not working",
      });

      expect(result.merchantInsightTags.length).toBeGreaterThan(0);
      expect(new Set(result.merchantInsightTags).size).toBe(
        result.merchantInsightTags.length,
      );
    });
  });

  describe("output shape", () => {
    it("always includes the stable output fields", () => {
      expectOutputShape(analyze());
      expectOutputShape(
        analyze({ reason: "wrong_size", comment: "too small" }),
      );
      expectOutputShape(
        analyze({ reason: "changed_mind", comment: "arrived cracked" }),
      );
    });
  });

  describe("confidence", () => {
    it("explicit known reason gives 0.95", () => {
      expect(analyze({ reason: "wrong_size" }).confidence).toBe(0.95);
    });

    it("keyword inferred reason gives 0.8", () => {
      expect(analyze({ comment: "too small" }).confidence).toBe(0.8);
    });

    it("unclear result gives 0.55", () => {
      expect(analyze().confidence).toBe(0.55);
    });

    it("changed_mind overridden by quality keyword gives 0.8", () => {
      expect(
        analyze({ reason: "changed_mind", comment: "not working" }).confidence,
      ).toBe(0.8);
    });
  });

  describe("exported helpers", () => {
    it("normalizeExplicitReason maps known aliases", () => {
      expect(normalizeExplicitReason("WRONG_SIZE")).toBe("wrong_size");
      expect(normalizeExplicitReason("unknown")).toBeNull();
    });

    it("normalizeStoreType normalizes personalized to personalised", () => {
      expect(normalizeStoreType("personalized")).toBe("personalised");
    });

    it("detectHighestPrecedenceMatch respects precedence order", () => {
      expect(detectHighestPrecedenceMatch("faulty and looks fake")).toBe(
        "authenticity_issue",
      );
    });
  });

  describe("store type normalization (Prompt 1B)", () => {
    it("unknown storeType returns general", () => {
      expect(analyze({ storeType: "mystery_shop" }).storeType).toBe("general");
    });

    it("missing storeType returns general", () => {
      expect(analyze({}).storeType).toBe("general");
    });

    it("supported storeType is preserved", () => {
      expect(analyze({ storeType: "footwear" }).storeType).toBe("footwear");
    });
  });

  describe("productContextTags (Prompt 1B)", () => {
    it("general storeType defaults productContextTags to []", () => {
      expect(analyze({ storeType: "general" }).productContextTags).toEqual([]);
    });

    it.each([
      ["fashion", "fashion_context"],
      ["footwear", "footwear_context"],
      ["electronics", "electronics_context"],
      ["beauty", "beauty_context"],
      ["skincare", "skincare_context"],
      ["jewellery", "jewellery_context"],
      ["homeware", "homeware_context"],
      ["furniture", "furniture_context"],
      ["custom", "custom_product_context"],
      ["personalised", "personalised_product_context"],
    ])("%s adds %s", (storeType, tag) => {
      expect(analyze({ storeType }).productContextTags).toContain(tag);
    });
  });

  describe("footwear store intelligence (Prompt 1B)", () => {
    it("footwear + hurts my foot maps to wrong_size fit_issue with comfort_issue", () => {
      const result = analyze({
        storeType: "footwear",
        comment: "it hurts my foot",
      });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.reasonGroup).toBe("fit_issue");
      expect(result.followUpType).toBe("size_or_comfort_preference");
      expect(result.merchantInsightTags).toContain("comfort_issue");
      expect(result.productContextTags).toContain("footwear_context");
    });

    it("footwear + too narrow maps to wrong_size fit_issue", () => {
      const result = analyze({
        storeType: "footwear",
        comment: "too narrow",
      });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.reasonGroup).toBe("fit_issue");
    });

    it("footwear + sole came off maps to durability_issue", () => {
      const result = analyze({
        storeType: "footwear",
        comment: "sole came off",
      });

      expect(result.qualityIssueType).toBe("durability_issue");
      expect(result.reasonGroup).toBe("quality_issue");
    });

    it("footwear + glue marks maps to finish_issue", () => {
      const result = analyze({
        storeType: "footwear",
        comment: "glue marks",
      });

      expect(result.qualityIssueType).toBe("finish_issue");
    });
  });

  describe("electronics store intelligence (Prompt 1B)", () => {
    it("electronics + not working maps to defect_issue with fault_issue tag", () => {
      const result = analyze({
        storeType: "electronics",
        comment: "not working",
      });

      expect(result.qualityIssueType).toBe("defect_issue");
      expect(result.reasonGroup).toBe("quality_issue");
      expect(result.merchantInsightTags).toContain("fault_issue");
      expect(result.productContextTags).toContain("electronics_context");
    });

    it("electronics + won't turn on maps to defect_issue", () => {
      const result = analyze({
        storeType: "electronics",
        comment: "won't turn on",
      });

      expect(result.qualityIssueType).toBe("defect_issue");
    });
  });

  describe("beauty and skincare store intelligence (Prompt 1B)", () => {
    it("beauty + caused rash becomes safety_sensitive with safety follow-up", () => {
      const result = analyze({
        storeType: "beauty",
        comment: "caused rash",
      });

      expect(result.qualityIssueType).toBe("safety_sensitive_issue");
      expect(result.severity).toBe("high");
      expect(result.recommendedNextStep).toBe("manual_review_or_safety_check");
      expect(result.merchantInsightTags).toContain("safety_sensitive");
      expect(result.productContextTags).toContain("beauty_context");
    });

    it("skincare + skin irritation becomes safety_sensitive_issue", () => {
      const result = analyze({
        storeType: "skincare",
        comment: "skin irritation",
      });

      expect(result.qualityIssueType).toBe("safety_sensitive_issue");
      expect(result.productContextTags).toContain("skincare_context");
    });
  });

  describe("jewellery store intelligence (Prompt 1B)", () => {
    it("jewellery + too small maps to wrong_size fit_issue", () => {
      const result = analyze({
        storeType: "jewellery",
        comment: "too small",
      });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.reasonGroup).toBe("fit_issue");
      expect(result.productContextTags).toContain("jewellery_context");
    });

    it("jewellery + looks fake maps to authenticity_issue", () => {
      const result = analyze({
        storeType: "jewellery",
        comment: "looks fake",
      });

      expect(result.qualityIssueType).toBe("authenticity_issue");
    });

    it("jewellery + looks different from photos maps to description_mismatch", () => {
      const result = analyze({
        storeType: "jewellery",
        comment: "looks different from photos",
      });

      expect(result.qualityIssueType).toBe("description_mismatch");
    });

    it("jewellery + wrong colour maps to changed_mind preference_issue", () => {
      const result = analyze({
        storeType: "jewellery",
        comment: "wrong colour",
      });

      expect(result.normalizedReason).toBe("changed_mind");
      expect(result.reasonGroup).toBe("preference_issue");
    });

    it("jewellery + colour different from photos maps to description_mismatch", () => {
      const result = analyze({
        storeType: "jewellery",
        comment: "colour different from photos",
      });

      expect(result.qualityIssueType).toBe("description_mismatch");
    });
  });

  describe("homeware and furniture store intelligence (Prompt 1B)", () => {
    it("furniture + too big for my room maps to dimension_issue", () => {
      const result = analyze({
        storeType: "furniture",
        comment: "too big for my room",
      });

      expect(result.normalizedReason).toBe("wrong_size");
      expect(result.reasonGroup).toBe("dimension_issue");
      expect(result.followUpType).toBe("dimension_preference");
      expect(result.merchantInsightTags).toContain("dimension_issue");
    });

    it("homeware + wrong dimensions maps to dimension_issue", () => {
      const result = analyze({
        storeType: "homeware",
        comment: "wrong dimensions",
      });

      expect(result.reasonGroup).toBe("dimension_issue");
      expect(result.productContextTags).toContain("homeware_context");
    });

    it("furniture + missing parts maps to missing_parts_issue", () => {
      const result = analyze({
        storeType: "furniture",
        comment: "missing parts",
      });

      expect(result.qualityIssueType).toBe("missing_parts_issue");
      expect(result.reasonGroup).toBe("quality_issue");
    });

    it("homeware + scratched maps to damage_issue", () => {
      const result = analyze({
        storeType: "homeware",
        comment: "scratched",
      });

      expect(result.qualityIssueType).toBe("damage_issue");
    });

    it("furniture + poor finish maps to finish_issue", () => {
      const result = analyze({
        storeType: "furniture",
        comment: "poor finish",
      });

      expect(result.qualityIssueType).toBe("finish_issue");
    });
  });

  describe("custom and personalised store intelligence (Prompt 1B)", () => {
    it("custom + changed_mind returns policy_sensitive insight", () => {
      const result = analyze({
        storeType: "custom",
        reason: "changed_mind",
      });

      expect(result.recommendedNextStep).toBe("check_policy_before_offer");
      expect(result.recoveryOpportunity).toBe("low");
      expect(result.merchantInsightTags).toContain("policy_sensitive");
      expect(result.productContextTags).toContain("custom_product_context");
    });

    it("personalised + changed_mind returns policy_sensitive insight", () => {
      const result = analyze({
        storeType: "personalised",
        reason: "changed_mind",
      });

      expect(result.recommendedNextStep).toBe("check_policy_before_offer");
      expect(result.merchantInsightTags).toContain("policy_sensitive");
    });

    it("custom + not working prioritizes defect_issue over policy_sensitive", () => {
      const result = analyze({
        storeType: "custom",
        reason: "changed_mind",
        comment: "not working",
      });

      expect(result.qualityIssueType).toBe("defect_issue");
      expect(result.merchantInsightTags).not.toContain("policy_sensitive");
    });

    it("personalised + missing parts prioritizes missing_parts_issue", () => {
      const result = analyze({
        storeType: "personalised",
        reason: "changed_mind",
        comment: "missing parts",
      });

      expect(result.qualityIssueType).toBe("missing_parts_issue");
      expect(result.merchantInsightTags).not.toContain("policy_sensitive");
    });
  });

  describe("store precedence safety (Prompt 1B)", () => {
    it("footwear + hurts but also fake chooses authenticity_issue", () => {
      const result = analyze({
        storeType: "footwear",
        comment: "hurts but also fake",
      });

      expect(result.qualityIssueType).toBe("authenticity_issue");
    });

    it("furniture + too big and missing parts chooses missing_parts_issue", () => {
      const result = analyze({
        storeType: "furniture",
        comment: "too big and missing parts",
      });

      expect(result.qualityIssueType).toBe("missing_parts_issue");
    });

    it("beauty + wrong size and caused rash chooses safety_sensitive_issue", () => {
      const result = analyze({
        storeType: "beauty",
        comment: "wrong size and caused rash",
      });

      expect(result.qualityIssueType).toBe("safety_sensitive_issue");
    });

    it("electronics + changed my mind but not working chooses defect_issue", () => {
      const result = analyze({
        storeType: "electronics",
        comment: "changed my mind but not working",
      });

      expect(result.qualityIssueType).toBe("defect_issue");
    });
  });
});
