# Hexabot Slack Channel Extension

`hexabot-channel-slack` adds Slack Events API, Interactivity, App Home, and Web
API support to Hexabot v3. It is a first-class v3 channel extension discovered
by `@hexabot-ai/api` and registered with the channel name `slack`.

[Hexabot](https://hexabot.ai/) is an open-source chatbot and agent builder for
multi-channel, multilingual conversational automation. Learn more in the
[Hexabot repository](https://github.com/Hexastack/Hexabot).

## Features

- Native Hexabot v3 `HttpChannelHandler` implementation.
- Slack request signing with `x-slack-signature`, `x-slack-request-timestamp`,
  `req.rawBody`, HMAC-SHA256, five-minute replay protection, and timing-safe
  comparison.
- Slack URL verification responses using the plaintext `challenge` expected by
  Slack.
- Events API support for direct messages, app mentions, file shares, and App
  Home opens.
- Interactivity support for Block Kit button postbacks.
- App Home publishing with custom Block Kit content and Hexabot menu actions.
- Subscriber identity based on Slack user IDs, with profile lookup through
  `users.info`.
- Authenticated private Slack file downloads for inbound attachments.
- Outbound text, quick replies, buttons, URL buttons, lists, carousels, and file
  uploads.
- Optional auto-join and retry for public channels when Slack returns
  `not_in_channel`.
- Optional non-DM thread replies using Slack `thread_ts`.

## Installation

Install the package in the same workspace or deployment that runs
`@hexabot-ai/api`:

```sh
npm add hexabot-channel-slack
```

Restart the Hexabot API after installation. The channel appears with the name
`slack`.

For local development inside this package:

```sh
npm install
npm test
npm run typecheck
npm run build
```

## Package Interface

- Package name: `hexabot-channel-slack`
- Channel name: `slack`
- Main package entry: `dist/index.js`
- Channel discovery entry: `dist/index.channel.js`
- Source webhook endpoint: `https://<your-domain>/api/webhook/<sourceId>`

## Prerequisites

Before configuring the channel, make sure you have:

- a Slack workspace;
- admin access to create and configure Slack apps in that workspace;
- a public HTTPS URL for the Hexabot API. For local testing, expose the API with
  a tunnel such as ngrok;
- a Hexabot v3 project running with this extension installed;
- Hexabot credentials created for the Slack bot token and signing secret.

This extension uses Slack HTTP Events and Interactivity. Socket Mode and OAuth
installation flows are intentionally out of scope for this release.

## Slack App Setup

You can create the Slack app from scratch or from a manifest. Both approaches
produce the same configuration.

### Option 1: Create App From Scratch

1. Open [Slack API Apps](https://api.slack.com/apps).
2. Click **Create New App**.
3. Choose **From scratch**.
4. Enter an app name and select the Slack workspace where it will be installed.
5. Open **Basic Information** and copy the **App ID** and **Signing Secret**.
6. Store the signing secret as a Hexabot credential.

### Option 2: Create App From Manifest

1. Open [Slack API Apps](https://api.slack.com/apps).
2. Click **Create New App**.
3. Choose **From an app manifest**.
4. Select the target workspace.
5. Paste a manifest similar to this one, replacing the placeholder URL and app
   name:

```yaml
display_information:
  name: Hexabot
features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: false
  bot_user:
    display_name: Hexabot
    always_online: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - im:history
      - im:write
      - users:read
      - files:read
      - files:write
      - channels:read
      - channels:join
settings:
  event_subscriptions:
    request_url: https://<your-domain>/api/webhook/<sourceId>
    bot_events:
      - app_mention
      - message.im
      - app_home_opened
  interactivity:
    is_enabled: true
    request_url: https://<your-domain>/api/webhook/<sourceId>
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

6. Create the app, then open **Basic Information** to copy the App ID and
   Signing Secret.

## OAuth Scopes

Open **OAuth & Permissions** and add these bot token scopes:

| Scope | Purpose |
| --- | --- |
| `app_mentions:read` | Read messages where the bot is mentioned. |
| `chat:write` | Send Slack messages. |
| `im:history` | Receive direct-message events. |
| `im:write` | Open/resume direct messages for App Home interactions. |
| `users:read` | Read Slack user profile data. |
| `files:read` | Download files shared with the bot. |
| `files:write` | Upload files from Hexabot to Slack. |
| `channels:read` | Read public channel metadata. |
| `channels:join` | Join public channels before retrying sends. |

After changing scopes, reinstall the app to the workspace.

## Events API Configuration

Open **Event Subscriptions** in the Slack app settings:

1. Enable events.
2. Set **Request URL** to:

```txt
https://<your-domain>/api/webhook/<sourceId>
```

3. Subscribe to these **Bot Events**:

- `app_mention`
- `message.im`
- `app_home_opened`

4. Save changes.

Slack verifies the URL by sending a `url_verification` request. The Hexabot
source must already have the correct signing secret credential configured so the
extension can verify the request before returning the challenge.

## Interactivity Configuration

Open **Interactivity & Shortcuts** in the Slack app settings:

1. Enable interactivity.
2. Set **Request URL** to the same v3 source endpoint:

```txt
https://<your-domain>/api/webhook/<sourceId>
```

3. Save changes.

The extension currently handles Block Kit button actions. URL-only buttons are
ignored because Slack opens the URL directly.

## App Home Configuration

Open **App Home** in the Slack app settings:

1. Enable the **Home Tab**.
2. Disable the **Messages Tab** unless your product flow needs it separately.
3. Save changes.

When a user opens App Home, Hexabot publishes:

- the custom Block Kit array from `home_tab_content`;
- Hexabot menu entries as Slack sections and buttons.

App Home opens do not emit chatbot message events.

## Install the Slack App

Open **Install App** in the Slack app settings:

1. Click **Install to Workspace**.
2. Authorize the requested scopes.
3. Copy the **Bot User OAuth Token** from **OAuth & Permissions**.
4. Store the bot token as a Hexabot credential.

## Hexabot Source Configuration

Create one Hexabot source for each Slack app/workspace pair.

Required settings:

- `bot_token`: credential containing the Slack Bot User OAuth Token.
- `signing_secret`: credential containing the Slack signing secret.
- `app_id`: Slack App ID. Events for other apps are ignored.

Optional settings:

- `team_id`: Slack workspace/team ID. When set, events for other workspaces are
  ignored.
- `home_tab_content`: JSON array of Slack Block Kit blocks rendered before the
  Hexabot menu in App Home.
- `enable_home_tab`: publish App Home content when a user opens the Home tab.
  Defaults to `true`.
- `reply_in_threads`: reply in the source Slack thread for non-DM
  conversations when thread metadata exists. Defaults to `true`.
- `auto_join_public_channels`: call `conversations.join` and retry once when
  Slack returns `not_in_channel` for a public channel. Defaults to `true`.
- `thread_inactivity_hours`: controls Hexabot v3 thread rollover. Defaults to
  `24`.

Save the source before verifying the Slack Events URL.

## Supported Inbound Messages

- Direct-message text from `message.im` becomes a Hexabot text event.
- App mentions from `app_mention` become text events after Slack bot mentions
  are stripped.
- Slack file shares with private download URLs become attachment events.
- Messages containing both text and files are split into one text event and one
  attachment event.
- Block Kit non-URL button clicks become postback events.
- App Home button clicks without a channel open/resume a DM through
  `conversations.open` before the postback is emitted.
- Bot messages, self-authored bot messages, unsupported message subtypes,
  URL-only buttons, wrong app IDs, and wrong team IDs are ignored.

Subscriber identity uses the Slack user ID as `senderForeignId`. Channel
attributes include:

- `teamId`
- `enterpriseId`
- `appId`
- `conversationId`
- `conversationType`
- `userId`
- `messageTs`
- `threadTs`

## Supported Outbound Messages

- Text messages are sent with `chat.postMessage`.
- Quick replies and postback buttons are sent as Block Kit `section` and
  `actions` blocks.
- URL buttons are sent as Slack URL buttons.
- Lists are sent as stacked `section` and `actions` blocks, capped to Slack
  message block limits.
- Oversized paginated lists reserve an action for `VIEW_MORE`.
- Carousels are sent as Slack carousel blocks capped at 10 cards.
- Attachments are sent with `filesUploadV2`.
- Quick replies after an attachment are sent as a follow-up Block Kit message.

## File Handling

Inbound Slack files are private. The extension downloads them with:

```txt
Authorization: Bearer <bot_token>
```

Outbound attachment messages upload Hexabot attachments through Slack
`filesUploadV2`. When the attachment reference is a URL, the extension downloads
the URL first and then uploads the resulting stream to Slack.

## Security Notes

Every Slack POST request is verified before decoding:

1. `x-slack-signature` must be present.
2. `x-slack-request-timestamp` must be present and no older than five minutes.
3. `req.rawBody` must be available.
4. The extension computes `v0:{timestamp}:{rawBody}` with HMAC-SHA256 and the
   source signing secret.
5. The computed digest is compared with Slack's digest using `timingSafeEqual`.

Ensure the Hexabot API keeps `req.rawBody` available for webhook routes.

## Troubleshooting

Slack URL verification fails:

- confirm the source has the correct signing secret credential;
- confirm the public URL reaches the Hexabot API route;
- confirm your reverse proxy does not strip Slack signature headers;
- confirm raw body capture is enabled.

Messages are not received:

- confirm the app is installed in the workspace;
- confirm `app_mention`, `message.im`, and `app_home_opened` are subscribed;
- for channel messages, invite the bot to the channel and mention it;
- direct messages require `im:history`.

Messages are not sent:

- confirm `chat:write` is granted and the app was reinstalled after scope
  changes;
- for public channels, keep `channels:join` and
  `auto_join_public_channels=true` or invite the bot manually;
- check Slack API errors in Hexabot logs.

Files are not downloaded or uploaded:

- confirm `files:read` and `files:write` are granted;
- confirm the bot can access the conversation where the file was shared;
- for outbound URL attachments, confirm the URL is reachable by the Hexabot API.

## Development

Common commands:

```sh
npm test
npm run typecheck
npm run build
npm run build:publish
npm pack --dry-run
```

`build:publish` removes generated output, builds `dist`, and verifies that the
package export files exist.

## Publishing

The package keeps the v2 release workflow commands:

```sh
npm run release:patch
npm run release:minor
```

Both commands create an npm version commit and tag, then push `main` with tags.
The GitHub Actions release workflow builds, tests, packs, and publishes the
package to npm when the tagged package version is not already published.

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish access for
  `hexabot-channel-slack`.

## Limitations

- Socket Mode is not implemented.
- OAuth installation flow is not implemented.
- Public-channel general history is not subscribed. Channel conversations are
  intentionally processed through `app_mention`.
- One source maps to one Slack app/workspace. Use multiple sources for multiple
  workspaces.

## Contributing

Contributions are welcome. Please read
[How to contribute to Hexabot](https://github.com/Hexastack/Hexabot/blob/main/CONTRIBUTING.md)
before submitting changes.

[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://github.com/Hexastack/Hexabot/blob/main/CODE_OF_CONDUCT.md)

Join the Hexabot community on [Discord](https://discord.gg/rNb9t2MFkG).

## License

This software is licensed under the Fair Core License, FCL-1.0-ALv2. Full terms
are available in [LICENSE.md](./LICENSE.md).
