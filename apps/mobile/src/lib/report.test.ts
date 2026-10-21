import { describe, expect, it } from "vitest";
import { phoneReportReasons, reportProblem, websiteReportPath } from "./report";

describe("reporting from the phone", () => {
  it("offers wrong AI labels for tracks only", () => {
    expect(phoneReportReasons("track")).toContain("ai_label");
    expect(phoneReportReasons("release")).not.toContain("ai_label");
    expect(phoneReportReasons("artist")).toEqual(["offensive", "impersonation"]);
  });

  it("sends copyright notices to the website's form, with the reason chosen", () => {
    expect(phoneReportReasons("track")).not.toContain("copyright");
    expect(websiteReportPath("track", "abc", "copyright")).toBe("/report/track/abc?reason=copyright");
    expect(websiteReportPath("artist", "the pines")).toBe("/report/artist/the%20pines");
  });

  it("says what's missing before sending", () => {
    const ready = { reason: "offensive" as const, details: "Hateful words in the title.", email: null };
    expect(reportProblem(ready)).toBeNull();
    expect(reportProblem({ ...ready, reason: null })).toBe("Choose what's wrong.");
    expect(reportProblem({ ...ready, details: " too short " })).toMatch(/at least 10 characters/);
    // Visitors need an email address so Trusic can reply.
    expect(reportProblem({ ...ready, email: "" })).toMatch(/email address/);
    expect(reportProblem({ ...ready, email: "sam@example.com" })).toBeNull();
  });
});
