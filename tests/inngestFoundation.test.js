import { describe, expect, it } from "vitest";
import { inngest } from "@/lib/inngest";
import { GET, POST, PUT } from "@/app/api/inngest/route";

describe("Inngest foundation", () => {
  it("exports ReturnRadar Inngest client", () => {
    expect(inngest.id).toBe("return-radar");
  });

  it("exports Inngest serve handlers", () => {
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
    expect(typeof PUT).toBe("function");
  });
});
