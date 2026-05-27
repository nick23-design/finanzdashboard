export type FactCheckStatus =
  | "pending_factcheck"
  | "verified"
  | "verified_with_warnings"
  | "needs_revision"
  | "failed_factcheck";

export type VeraIssueType =
  | "schema"
  | "valuation_mixing"
  | "unsupported_claim"
  | "wrong_driver"
  | "stale_data"
  | "overconfident_recommendation"
  | "number_mismatch";

export type VeraFactCheckResult = {
  status: FactCheckStatus;
  checkedAt: string;
  severity: "none" | "low" | "medium" | "high";
  issues: {
    type: VeraIssueType;
    message: string;
    affectedSection?: string;
    suggestedFix?: string;
  }[];
};
