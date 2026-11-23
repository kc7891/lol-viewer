import type { Lane } from "@lol-viewer/protocol";

/** LCU says "utility" for support and "" when positions are not assigned. */
export function normalizeLane(raw: string | undefined | null): Lane | null {
  switch ((raw ?? "").toLowerCase()) {
    case "top":
      return "top";
    case "jungle":
      return "jungle";
    case "middle":
    case "mid":
      return "middle";
    case "bottom":
    case "bot":
      return "bottom";
    case "utility":
    case "support":
      return "support";
    default:
      return null;
  }
}
