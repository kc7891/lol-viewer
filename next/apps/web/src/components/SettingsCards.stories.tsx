import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_URL_TEMPLATES } from "@lol-viewer/core";
import { scenes } from "../fixtures.ts";
import { Harness } from "../storyHelpers.tsx";
import { DisplayCard, LcuCard, UrlsCard, VersionCard } from "./SettingsPage.tsx";

const Wrap = ({ children, options }: { children: React.ReactNode; options?: Parameters<typeof Harness>[0]["bridgeOptions"] }) => (
  <Harness match={scenes.idle.match} bridgeOptions={options} height="auto" width={680}>
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
export const VersionDev: Story = { render: () => <Wrap><VersionCard /></Wrap> };
export const VersionDesktop: Story = {
  render: () => (
    <Wrap options={{ app: { info: async () => ({ version: "0.1.0", platform: "win32" }) } }}>
      <VersionCard />
    </Wrap>
  ),
};
