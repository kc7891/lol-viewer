import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_SETTINGS, DEFAULT_URL_TEMPLATES, type Settings } from "@lol-viewer/core";
import { App, type AppProps } from "./App.tsx";
import { emptyViewer, firstViewer, manualViewers, scenes, threeViewers, viewerLimit, withHidden, type Scene } from "./fixtures.ts";
import { Harness } from "./storyHelpers.tsx";
import type { Toast } from "./state/toasts.tsx";

type Args = { scene: Scene; settings?: Settings; app?: AppProps };

const meta = {
  title: "Screens/App",
  parameters: { layout: "fullscreen" },
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<Args>;

/** Stories render from closures (not args): Storybook would clone and re-serialize big Scene objects. */
const story = ({ scene, settings, app }: Args): Story => ({
  render: () => (
    <Harness match={scene.match} settings={settings} bridgeOptions={{ lcu: true }}>
      <App initialWorkspace={scene.ws} autoDismissToasts={false} {...app} />
    </Harness>
  ),
});

export const Disconnected: Story = story({ scene: scenes.disconnected });
export const Connecting: Story = story({ scene: scenes.connecting });
export const WaitingForChampSelect: Story = story({ scene: scenes.idle });
export const ChampSelectStarted: Story = story({ scene: scenes.champSelectStart });
export const ChampSelectPartial: Story = story({ scene: scenes.champSelectPartial });
/** 10 champions placed, picked viewers for my pick, every enemy waiting under Enemy picks. */
export const ChampSelectComplete: Story = story({ scene: scenes.champSelectComplete });
export const InGame: Story = story({ scene: scenes.inGame });
export const SecondMatchClosesEverything: Story = story({ scene: scenes.secondMatch });

export const ThreeViewers: Story = story({ scene: threeViewers });
export const HiddenViewer: Story = story({ scene: withHidden });
/** A viewer opened by hand, and a new one that still needs a champion (the picker is open). */
export const ManualViewers: Story = story({ scene: manualViewers });
export const EmptyViewer: Story = story({ scene: emptyViewer });
/** 20/20: more panes than fit, the strip scrolls sideways. */
export const ViewerLimit: Story = story({ scene: viewerLimit });

const panel = (scene: Scene, kind: "champion" | "opponent" | "lane" | "qr"): Args => ({
  scene,
  app: { initialPanels: { [firstViewer(scene).id]: kind } },
});
export const ChampionPanelOpen: Story = story(panel(threeViewers, "champion"));
export const OpponentPanelOpen: Story = story(panel(threeViewers, "opponent"));
export const LanePanelOpen: Story = story(panel(threeViewers, "lane"));
export const QrPanelOpen: Story = story(panel(threeViewers, "qr"));

export const LiveGame: Story = story({ scene: scenes.inGame, app: { initialPage: "live" } });
export const LiveGameQr: Story = story({ scene: scenes.inGame, app: { initialPage: "live", initialLiveQr: true } });
export const Settings_: Story = { ...story({ scene: scenes.champSelectComplete, app: { initialPage: "settings" } }), name: "Settings" };
export const SettingsUrlErrors: Story = story({
  scene: scenes.idle,
  app: {
    initialPage: "settings",
    urlsInitialDraft: { ...DEFAULT_URL_TEMPLATES, counter: "", liveGame: "  " },
    urlsInitialErrors: ["counter", "liveGame"],
  },
});
export const SettingsUpdateBadge: Story = story({ scene: scenes.idle, app: { updateAvailable: true } });

export const UiSizeSmall: Story = story({ scene: threeViewers, settings: { ...DEFAULT_SETTINGS, uiSize: "small" } });
export const UiSizeLarge: Story = story({ scene: threeViewers, settings: { ...DEFAULT_SETTINGS, uiSize: "large" } });
export const QrButtonOff: Story = story({ scene: threeViewers, settings: { ...DEFAULT_SETTINGS, qrButton: false } });

const toast = (id: number, kind: Toast["kind"], text: string): Toast => ({ id, kind, text });
const twentyToasts: Toast[] = Array.from({ length: 20 }, (_, i) =>
  toast(i + 1, (["info", "success", "warn"] as const)[i % 3]!, `Notification ${i + 1}: ${["Matchup refreshed.", "Copied to clipboard", "Viewer limit reached (20). Close one first."][i % 3]}`),
);
/** The most recent 20 stay; the list scrolls inside the sidebar footer. */
export const ToastsAtLimit: Story = story({ scene: viewerLimit, app: { initialToasts: twentyToasts } });
export const ToastsFew: Story = story({
  scene: threeViewers,
  app: { initialToasts: [toast(1, "warn", "Viewer limit reached (20). Close one first."), toast(2, "success", "Copied to clipboard")] },
});

