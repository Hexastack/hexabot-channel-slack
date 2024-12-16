/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { ChannelSetting } from '@/channel/types';
import { SettingType } from '@/setting/schemas/types';

import * as SlackTypes from '@slack/types';

export const SLACK_CHANNEL_NAME = 'slack-channel';

export const SLACK_CHANNEL_NAMESPACE = 'slack_channel';

export const DEFAULT_HOME_TAB_CONTENT: SlackTypes.KnownBlock[] = [
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
      text: 'Welcome to *Hexabot*!\n',
    },
  },
];

export enum SettingLabel {
  app_id = 'app_id',
  access_token = 'access_token',
  signing_secret = 'signing_secret',
  home_tab_content = 'home_tab_content',
}

export default [
  {
    group: SLACK_CHANNEL_NAMESPACE,
    label: SettingLabel.app_id,
    value: '',
    type: SettingType.text,
  },
  {
    group: SLACK_CHANNEL_NAMESPACE,
    label: SettingLabel.access_token,
    value: '',
    type: SettingType.secret,
  },
  {
    group: SLACK_CHANNEL_NAMESPACE,
    label: SettingLabel.signing_secret,
    value: '',
    type: SettingType.secret,
  },
  {
    group: SLACK_CHANNEL_NAMESPACE,
    label: SettingLabel.home_tab_content,
    value: JSON.stringify(DEFAULT_HOME_TAB_CONTENT, null, 2),
    type: SettingType.textarea,
  },
] as const satisfies ChannelSetting<typeof SLACK_CHANNEL_NAME>[];
