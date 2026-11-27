import { useEffect, useState } from "react";
import type { TeamsApi, TeamsState } from "@lol-viewer/protocol";

/** The latest TeamsState main pushed; null until the first one, and always null where the bridge has no `teams` (browser). */
export function useTeamsState(api: TeamsApi | undefined): TeamsState | null {
  const [state, setState] = useState<TeamsState | null>(null);
  useEffect(() => {
    if (!api) return setState(null);
    return api.onState(setState);
  }, [api]);
  return state;
}
