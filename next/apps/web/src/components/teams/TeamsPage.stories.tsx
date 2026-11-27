import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_SETTINGS, type Settings, type TeamPlayerPref } from "@lol-viewer/core";
import { fx, fixtureTeamsApi, JUNGLE_CLASH, SOME_PREFS, teamsState, type TeamsFixture } from "../../fixtures/teams.ts";
import { scenes } from "../../fixtures.ts";
import { Harness } from "../../storyHelpers.tsx";
import { TeamsPage, type TeamsPageInitial } from "./TeamsPage.tsx";

const meta = { title: "Screens/Teams", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

type Args = { state?: TeamsFixture; prefs?: Record<string, TeamPlayerPref>; initial?: TeamsPageInitial; browser?: boolean };

/** Stories render from closures: the fixture builds its state once, when the story renders. */
const story = ({ state = {}, prefs = {}, initial, browser = false }: Args = {}): Story => ({
  render: () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, featureFlags: { teamBalancer: true }, teamPlayers: prefs };
    return (
      <Harness match={scenes.idle.match} settings={settings} height="auto" bridgeOptions={browser ? {} : { teams: fixtureTeamsApi(teamsState(state)) }}>
        <div className="teams-wrap" style={{ minHeight: "100vh" }}>
          <TeamsPage notify={() => {}} initial={initial} />
        </div>
      </Harness>
    );
  },
});

/** Not in a custom lobby: nobody listed, the Prefetch panel is open. */
export const NoLobby: Story = story({ state: { lobby: "none" } });
/** Not in a lobby, but eight saved people were added to Players by hand. */
export const NoLobbyAddedPeople: Story = story({
  state: { lobby: "none" },
  initial: { prefetchOpen: false, extras: [1, 2, 3, 4, 6, 7, 8, 10].map(fx) },
});
/** Ten in the team slots, two spectators on the Bench: the first proposals. */
export const TenPlayers: Story = story({ initial: { prefetchOpen: false } });
export const TenPlayersLanesFirst: Story = story({ initial: { prefetchOpen: false, view: "laneFirst" } });
/** Eight in the team slots: no lanes, each player's main lane in brackets. */
export const EightPlayers: Story = story({ state: { lobby: "eight" }, initial: { prefetchOpen: false } });
/** Nine in the team slots: no proposal, the message says how many. */
export const NinePlayers: Story = story({ state: { lobby: "nine" }, initial: { prefetchOpen: false } });
/** Three players locked to Jungle: the balancer cannot keep that. */
export const LockClash: Story = story({ prefs: JUNGLE_CLASH, initial: { prefetchOpen: false } });
/** A player's manual settings are open (lock, preferred lanes, avoid, rank override). */
export const ManualSettings: Story = story({ prefs: { ...SOME_PREFS, [fx(2)]: { lock: "jungle", ng: ["support", "top"], rankOverride: 1500 } }, initial: { prefetchOpen: false, prefsOpen: fx(2) } });
/** Two players just arrived in the lobby: spinners, the rest is already there. */
export const Fetching: Story = story({ state: { fetching: [3, 7] }, initial: { prefetchOpen: false } });
/** Someone from the Bench was moved to Players. */
export const BenchMovedIn: Story = story({ initial: { prefetchOpen: false, moved: { [fx(11)]: "in", [fx(10)]: "out" } } });

const running = { running: true, done: 12, total: 30, failed: 1, current: fx(7) };
export const PrefetchFriends: Story = story({ state: { lobby: "none", prefetch: running }, initial: { tab: "friends" } });
export const PrefetchRecent: Story = story({ state: { lobby: "none" }, initial: { tab: "recent" } });
export const PrefetchRiotIds: Story = story({ state: { lobby: "none" }, initial: { tab: "riotIds", riotIds: "Player20#tag20\nPlayer21#tag21\nPlayer22#tag22\nno-tag-here" } });
export const PrefetchLobby: Story = story({ initial: { prefetchOpen: true, tab: "lobby" } });
export const PrefetchPaused: Story = story({ state: { prefetch: { ...running, pausedUntil: Date.now() + 45_000 } }, initial: { prefetchOpen: true, tab: "lobby" } });
export const PrefetchSaved: Story = story({ initial: { prefetchOpen: true, tab: "saved" } });
/** A saved player with a rank estimate: the games it came from, lane bars, manual settings, Refresh / Forget. */
export const SavedDetails: Story = story({ prefs: SOME_PREFS, initial: { prefetchOpen: true, tab: "saved", savedOpen: fx(4) } });

/** The browser build has no League Client: Teams says so. */
export const Browser: Story = story({ browser: true });
