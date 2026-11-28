import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_SETTINGS, type SavedMatchup, type SavedRoster, type Settings, type TeamPlayerPref } from "@lol-viewer/core";
import { CHIP_STATES, FIXTURE_MATCHUPS, FIXTURE_ROSTERS, fx, fixtureTeamsApi, JUNGLE_CLASH, SOME_PREFS, teamsState, type TeamsFixture } from "../../fixtures/teams.ts";
import { scenes } from "../../fixtures.ts";
import { Harness } from "../../storyHelpers.tsx";
import type { ImportPlan } from "./model.ts";
import { TeamsPage, type TeamsPageInitial } from "./TeamsPage.tsx";

const meta = { title: "Screens/Teams", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

type Args = { state?: TeamsFixture; prefs?: Record<string, TeamPlayerPref>; initial?: TeamsPageInitial; browser?: boolean; rosters?: SavedRoster[]; matchups?: SavedMatchup[] };

/** Stories render from closures: the fixture builds its state once, when the story renders. */
const story = ({ state = {}, prefs = {}, initial, browser = false, rosters = [], matchups = [] }: Args = {}): Story => ({
  render: () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, featureFlags: { teamBalancer: true }, teamPlayers: prefs, teamRosters: rosters, teamMatchups: matchups };
    return (
      <Harness match={scenes.idle.match} settings={settings} height="auto" bridgeOptions={browser ? {} : { teams: fixtureTeamsApi(teamsState(state)) }}>
        <div className="teams-wrap" style={{ minHeight: "100vh" }}>
          <TeamsPage notify={() => {}} initial={initial} />
        </div>
      </Harness>
    );
  },
});

const EVERYONE = { players: Array.from({ length: 14 }, (_, i) => i + 1) };

// ── Match ──
/** Ten in the team slots, two spectators unticked: the first proposal (priority Rank). */
export const MatchTenPlayers: Story = story();
export const MatchLanesPriority: Story = story({ initial: { priority: "laneFirst" } });
/** Every chip state: star (two on Player1), lock, avoid, a rank set by hand (gold frame), and the history lines under the chips. */
export const MatchChipStates: Story = story({ prefs: CHIP_STATES });
/** Eight in the team slots: no lanes, each player's main lane in brackets. */
export const MatchEightPlayers: Story = story({ state: { lobby: "eight" } });
/** Nine in the team slots: no proposal, "Pick 6, 8 or 10" next to the heading. */
export const MatchNinePlayers: Story = story({ state: { lobby: "nine" } });
/** Three players locked to Jungle: the balancer cannot keep that. */
export const MatchLockClash: Story = story({ prefs: JUNGLE_CLASH });
export const MatchFetching: Story = story({ state: { fetching: [3, 7] } });
/** Two spectators ticked in, two team players unticked. */
export const MatchSpectatorsIncluded: Story = story({ initial: { moved: { [fx(11)]: "in", [fx(12)]: "in", [fx(10)]: "out", [fx(5)]: "out" } } });
/** Not in a lobby: nobody listed yet. */
export const MatchNoLobby: Story = story({ state: { lobby: "none" } });
/** Not in a lobby, eight saved people were added by hand. */
export const MatchNoLobbyAddedPeople: Story = story({ state: { lobby: "none" }, initial: { extras: [1, 2, 3, 4, 6, 7, 8, 10].map(fx) } });
/** "+ Add people" is open: the saved people who are not on the list (search). */
export const MatchAddPeopleOpen: Story = story({ state: EVERYONE, initial: { addPeopleOpen: true } });
/** The rank popover of Player9 (unranked, no estimate): Auto, tier, division. */
export const MatchRankPopover: Story = story({ initial: { rankOpen: fx(9) } });
/** The Discord text is shown only in Preview. */
export const MatchDiscordPreview: Story = story({ initial: { preview: true } });
/** A hand-swapped proposal shows "Edited" and Reset: see the Storybook E2E. */
export const MatchNoPreferences: Story = story({ prefs: {} });

// ── Rosters (M-042) ──
/** Rosters ▾ with nothing saved yet: Save current as… is the only action. */
export const RostersMenuEmpty: Story = story({ initial: { rosters: "menu" } });
/** Rosters ▾ with three saved rosters (newest first, with the number of people). */
export const RostersMenu: Story = story({ rosters: FIXTURE_ROSTERS, initial: { rosters: "menu" } });
/** Save current as…: the name is asked; a name that already exists turns the button into Overwrite (see the Storybook E2E). */
export const RosterSaveDialog: Story = story({ rosters: FIXTURE_ROSTERS, initial: { rosters: "save" } });
export const RosterManageDialog: Story = story({ rosters: FIXTURE_ROSTERS, initial: { rosters: "manage" } });
/** Manage rosters with a copy just made: its name is in the rename field. */
export const RosterManageRename: Story = story({ rosters: FIXTURE_ROSTERS, initial: { rosters: "manage", rosterEditing: "ro-friday" } });

// ── Matchups (M-042) ──
/** Saving the proposal on screen: the name is asked. */
export const MatchupSaveDialog: Story = story({ matchups: FIXTURE_MATCHUPS, initial: { saveMatchupOpen: true } });
export const MatchupsEmpty: Story = story({ initial: { page: "matchups" } });
/** Three saved splits: ten people (Player3 shows `G2 → P4`), eight without lanes, and one with a guest who is not in People. */
export const MatchupsList: Story = story({ matchups: FIXTURE_MATCHUPS, initial: { page: "matchups" } });
export const MatchupsMenu: Story = story({ matchups: FIXTURE_MATCHUPS, initial: { page: "matchups", matchupMenuId: "mu-ten" } });
export const MatchupsSearch: Story = story({ matchups: FIXTURE_MATCHUPS, initial: { page: "matchups", matchupQuery: "player99" } });
/** After Open in Match: the saved split is the proposal ("Saved: Friday 5v5", Reset), and the checks are its ten people. */
export const MatchupOpenedInMatch: Story = story({ matchups: FIXTURE_MATCHUPS, initial: { openMatchupId: "mu-ten" } });

// ── People ──
const running = { running: true, done: 12, total: 30, failed: 1, current: fx(7) };
/** Everybody saved (14): same chips and badge as Match, a name-only person, one whose last fetch failed. */
export const PeopleTable: Story = story({ state: EVERYONE, prefs: CHIP_STATES, initial: { page: "people" } });
export const PeopleSortedByRank: Story = story({ state: EVERYONE, prefs: CHIP_STATES, initial: { page: "people", sort: "rank" } });
export const PeopleOldMissing: Story = story({ state: EVERYONE, initial: { page: "people", filter: "old" } });
export const PeopleInLobby: Story = story({ state: EVERYONE, initial: { page: "people", filter: "lobby" } });
export const PeopleSearch: Story = story({ state: EVERYONE, initial: { page: "people", query: "player1" } });
/** A person's details: three ranks, the estimate and the games it came from, the lane shares. */
export const PeopleDetails: Story = story({ state: EVERYONE, prefs: SOME_PREFS, initial: { page: "people", detailsOpen: fx(4) } });
export const PeopleRankPopover: Story = story({ state: EVERYONE, initial: { page: "people", rankOpen: fx(13) } });
export const PeopleFetching: Story = story({ state: { ...EVERYONE, prefetch: running, fetching: [7] }, initial: { page: "people", filter: "old" } });
export const PeoplePaused: Story = story({ state: { ...EVERYONE, prefetch: { ...running, pausedUntil: Date.now() + 45_000 } }, initial: { page: "people" } });
/** The ⋯ menu: Fetch all again, Export / Import preferences…, Clear all cached data. */
export const PeopleMenu: Story = story({ state: EVERYONE, prefs: CHIP_STATES, initial: { page: "people", menuOpen: true } });
const plan: ImportPlan = { matched: [fx(1), fx(2), fx(3), fx(8)].map((puuid) => ({ puuid, pref: { lock: "top" } })), notFound: ["Player99#tag9"], replacing: 2 };
/** Importing a preferences file: the confirm bar says how many people, how many replace, how many were not found. */
export const PeopleImportConfirm: Story = story({ state: EVERYONE, prefs: CHIP_STATES, initial: { page: "people", importPlan: plan } });
export const PeopleEmpty: Story = story({ state: { players: [], lobby: "none" }, initial: { page: "people" } });

// ── Add people ──
export const AddFromFriendGroup: Story = story({ state: { lobby: "none", ...EVERYONE }, initial: { page: "people", addMode: "friends" } });
export const AddFromRecent: Story = story({ state: { lobby: "none" }, initial: { page: "people", addMode: "recent" } });
export const AddByRiotId: Story = story({ state: { lobby: "none" }, initial: { page: "people", addMode: "riotIds", riotIds: "Player20#tag20\nPlayer21#tag21\nPlayer22#tag22\nno-tag-here" } });

/** The browser build has no League Client: Teams says so. */
export const Browser: Story = story({ browser: true });
