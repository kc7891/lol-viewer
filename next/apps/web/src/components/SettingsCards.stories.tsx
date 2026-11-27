import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_SETTINGS, DEFAULT_URL_TEMPLATES, type Settings } from "@lol-viewer/core";
import { formatProbeReport } from "@lol-viewer/core";
import { MOCK_PROBE_REPORT, mockUpdates } from "../bridge/mock.ts";
import { scenes, updateStatuses } from "../fixtures.ts";
import { Harness } from "../storyHelpers.tsx";
import { DisplayCard, FeatureFlagsCard, LcuCard, LcuCheckCard, UrlsCard, VersionCard } from "./SettingsPage.tsx";

const Wrap = ({ children, options, settings }: { children: React.ReactNode; options?: Parameters<typeof Harness>[0]["bridgeOptions"]; settings?: Settings }) => (
  <Harness match={scenes.idle.match} bridgeOptions={options} settings={settings} height="auto" width={680}>
    <div className="settings-inner">{children}</div>
  </Harness>
);

const meta = { title: "Components/SettingsCards", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Urls: Story = { render: () => <Wrap><UrlsCard onSaved={() => {}} notify={() => {}} /></Wrap> };
/** Empty fields are flagged and nothing is saved. */
export const UrlsWithErrors: Story = {
  render: () => (
    <Wrap>
      <UrlsCard
        onSaved={() => {}}
        notify={() => {}}
        initialDraft={{ ...DEFAULT_URL_TEMPLATES, build: "", aram: "" }}
        initialErrors={["build", "aram"]}
      />
    </Wrap>
  ),
};
export const LeagueClientConnected: Story = {
  render: () => (
    <Wrap options={{ lcu: true }}>
      <LcuCard connection="connected" />
    </Wrap>
  ),
};
export const LeagueClientDisconnected: Story = {
  render: () => (
    <Wrap options={{ lcu: true }}>
      <LcuCard connection="disconnected" />
    </Wrap>
  ),
};
export const LeagueClientBrowser: Story = { render: () => <Wrap><LcuCard connection="connected" /></Wrap> };
export const Display: Story = { render: () => <Wrap><DisplayCard /></Wrap> };
const win = { info: async () => ({ version: "0.1.0", platform: "win32" }) };
const mac = { info: async () => ({ version: "0.1.0", platform: "darwin" }) };
/** Desktop app on Windows, defaults: the overlay switch is disabled until Live game data is on. */
export const FeatureFlags: Story = { render: () => <Wrap options={{ live: true, overlay: true, app: win }}><FeatureFlagsCard notify={() => {}} /></Wrap> };
/** Live game data on: the overlay switch can be turned on. */
export const FeatureFlagsLiveOn: Story = {
  render: () => (
    <Wrap options={{ live: true, overlay: true, app: win }} settings={{ ...DEFAULT_SETTINGS, featureFlags: { liveClientData: true } }}>
      <FeatureFlagsCard notify={() => {}} />
    </Wrap>
  ),
};
/** Both flags on, Top right selected (M-036); with the flags off the position picker is disabled (see FeatureFlags). */
export const FeatureFlagsOn: Story = {
  render: () => (
    <Wrap
      options={{ live: true, overlay: true, app: win }}
      settings={{ ...DEFAULT_SETTINGS, featureFlags: { liveClientData: true, inGameOverlay: true }, overlayPosition: { horizontal: "right", vertical: "top" } }}
    >
      <FeatureFlagsCard notify={() => {}} />
    </Wrap>
  ),
};
/** Not Windows: the overlay flag says "Windows only" (main does nothing there). */
export const FeatureFlagsNotWindows: Story = {
  render: () => (
    <Wrap options={{ live: true, overlay: true, app: mac }} settings={{ ...DEFAULT_SETTINGS, featureFlags: { liveClientData: true } }}>
      <FeatureFlagsCard notify={() => {}} />
    </Wrap>
  ),
};
export const FeatureFlagsBrowser: Story = { render: () => <Wrap><FeatureFlagsCard notify={() => {}} /></Wrap> };
export const VersionDev: Story = { render: () => <Wrap><VersionCard /></Wrap> };
export const VersionDesktop: Story = {
  render: () => (
    <Wrap options={{ app: { info: async () => ({ version: "0.1.0", platform: "win32" }) } }}>
      <VersionCard />
    </Wrap>
  ),
};

const desktop = { info: async () => ({ version: "0.1.0", platform: "win32" }) };
const withUpdates = (status: keyof typeof updateStatuses, simulate = false): Story => ({
  render: () => (
    <Wrap options={{ app: desktop, updates: mockUpdates(updateStatuses[status], simulate) }}>
      <VersionCard />
    </Wrap>
  ),
});
/** Dev / packaged-less runs: the desktop bridge exists but updates are off. */
export const VersionUpdatesOff: Story = withUpdates("unsupported");
export const VersionNotChecked: Story = withUpdates("idle");
export const VersionChecking: Story = withUpdates("checking");
export const VersionUpToDate: Story = withUpdates("notAvailable");
export const VersionUpdateAvailable: Story = withUpdates("available");
export const VersionDownloading: Story = withUpdates("downloading");
export const VersionReadyToInstall: Story = withUpdates("downloaded");
export const VersionUpdateError: Story = withUpdates("error");
/** Buttons play out a fake update (used by the Storybook e2e). */
export const VersionUpdateFlow: Story = withUpdates("idle", true);

// LCU check (M-039): the desktop bridge has probe(); the browser bridge does not.
const reportText = formatProbeReport(MOCK_PROBE_REPORT);
const withProbe = {
  lcu: {
    reconnect() {},
    resync() {},
    probe: async () => ({ text: reportText, report: MOCK_PROBE_REPORT }),
  },
};
export const LcuCheckIdle: Story = { render: () => <Wrap options={withProbe}><LcuCheckCard connection="connected" /></Wrap> };
export const LcuCheckDisconnected: Story = { render: () => <Wrap options={withProbe}><LcuCheckCard connection="disconnected" /></Wrap> };
export const LcuCheckRunning: Story = {
  render: () => (
    <Wrap options={withProbe}>
      <LcuCheckCard connection="connected" initial={{ running: { done: 12, total: 20 } }} />
    </Wrap>
  ),
};
export const LcuCheckResult: Story = {
  render: () => (
    <Wrap options={withProbe}>
      <LcuCheckCard connection="connected" initial={{ text: reportText }} />
    </Wrap>
  ),
};
export const LcuCheckBrowser: Story = { render: () => <Wrap><LcuCheckCard connection="connected" /></Wrap> };
