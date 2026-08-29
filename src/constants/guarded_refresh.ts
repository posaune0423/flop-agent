export const APPROVED_ONBOARDING_PLAN_HASH =
  "da3c27957b0f7e03e1f5d35f7f9623c739f8e7cfcec2f414890a16812b85749e";

export const APPROVED_ORIGIN = "https://technocore.chat";
export const GUARDED_RUNTIME_ROOT = "/var/db/flop-agent-refresh";
export const MIN_REFRESH_INTERVAL_MS = 5 * 24 * 60 * 60 * 1_000;
export const GUARDED_RECEIPT_ID = "technocore-refresh-guarded";
export const APPROVED_NOTES = [
  {
    ns: "did-55",
    key: "0a9b014ad560a2",
    sha256: "c9e47f8c93ffdba878bb8eac4c7950f14f17be5d4d79084186dbf7be67516962",
  },
  {
    ns: "contrib",
    key: "550a9b014ad560a2",
    sha256: "0459e0340ace2a2bf2f843a2a713c469f5e1d55e6e84670d3634b01f1215190e",
  },
] as const;
