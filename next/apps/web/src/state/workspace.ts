import { useEffect, useReducer, type Dispatch } from "react";
import { initialWorkspace, workspaceReducer, type Workspace, type WorkspaceAction } from "@lol-viewer/core";
import type { MatchState } from "@lol-viewer/protocol";

/**
 * The renderer's Workspace: every MatchState snapshot becomes a `match` action,
 * everything the user does is another action (M-011). `initial` is for stories and tests.
 */
export function useWorkspace(match: MatchState, initial?: Workspace): [Workspace, Dispatch<WorkspaceAction>] {
  const [ws, dispatch] = useReducer(workspaceReducer, initial, (i) => i ?? initialWorkspace());
  useEffect(() => {
    dispatch({ type: "match", state: match });
  }, [match]);
  return [ws, dispatch];
}
