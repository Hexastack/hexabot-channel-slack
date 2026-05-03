/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

export const SLACK_CHANNEL_NAME = 'slack' as const;

export const SLACK_DEFAULT_HOME_TAB_CONTENT = [
  {
    type: 'header',
    text: {
      type: 'plain_text',
      text: 'Hexabot',
      emoji: true,
    },
  },
  {
    type: 'divider',
  },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: 'Welcome to *Hexabot*.',
    },
  },
];

export const SLACK_DEFAULT_HOME_TAB_CONTENT_JSON = JSON.stringify(
  SLACK_DEFAULT_HOME_TAB_CONTENT,
  null,
  2,
);

const credentialSetting = (title: string, description: string) =>
  z.string().default('').meta({
    title,
    description,
    'ui:widget': 'AutoCompleteWidget',
    'ui:options': {
      entity: 'Credential',
      valueKey: 'id',
      labelKey: 'name',
      enableEntityAddButton: true,
    },
  });

export const SLACK_CHANNEL_SOURCE_SETTINGS_SCHEMA = z
  .strictObject({
    bot_token: credentialSetting(
      'Bot token credential',
      'Credential containing the Slack bot token used for Web API calls.',
    ),
    signing_secret: credentialSetting(
      'Signing secret credential',
      'Credential containing the Slack signing secret used to verify webhook requests.',
    ),
    app_id: z.string().default('').meta({
      title: 'App ID',
      description:
        'Slack application ID. When set, events for other Slack apps are ignored.',
    }),
    team_id: z.string().default('').meta({
      title: 'Team ID',
      description:
        'Optional Slack workspace/team ID. When set, events for other workspaces are ignored.',
    }),
    home_tab_content: z.string().default(SLACK_DEFAULT_HOME_TAB_CONTENT_JSON).meta({
      title: 'Home tab content',
      description:
        'JSON array of Slack Block Kit blocks rendered before the Hexabot menu.',
      'ui:widget': 'textarea',
    }),
    enable_home_tab: z.boolean().default(true).meta({
      title: 'Enable Home tab',
      description:
        'Publish the Slack App Home tab when a Slack user opens it.',
    }),
    reply_in_threads: z.boolean().default(true).meta({
      title: 'Reply in threads',
      description:
        'Reply in the source Slack thread for non-DM conversations when thread metadata is available.',
    }),
    auto_join_public_channels: z.boolean().default(true).meta({
      title: 'Auto-join public channels',
      description:
        'Attempt conversations.join and retry once when Slack reports the bot is not in a public channel.',
    }),
    thread_inactivity_hours: z.int().nonnegative().default(24).meta({
      title: 'Thread inactivity (hours)',
      description:
        'Automatically start a new thread when the last message is older than this threshold.',
    }),
  })
  .meta({
    title: 'Slack Channel',
  });

export type SlackChannelSettings = z.infer<
  typeof SLACK_CHANNEL_SOURCE_SETTINGS_SCHEMA
>;

export const SLACK_CREDENTIAL_SETTING_KEYS = [
  'bot_token',
  'signing_secret',
] as const;

export type SlackCredentialSettingKey =
  (typeof SLACK_CREDENTIAL_SETTING_KEYS)[number];

export const SLACK_REQUIRED_SETTING_KEYS = [
  ...SLACK_CREDENTIAL_SETTING_KEYS,
  'app_id',
] as const;

export type SlackRequiredSettingKey =
  (typeof SLACK_REQUIRED_SETTING_KEYS)[number];

export type SlackResolvedChannelSettings = SlackChannelSettings;
