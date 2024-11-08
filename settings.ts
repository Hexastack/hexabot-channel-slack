import { SettingType } from '@/setting/schemas/types';

import { ChannelSetting } from '@/channel/types';
import { Slack } from './types';

export const SLACK_CHANNEL_NAME = 'slack-channel';

export const SLACK_GROUP_NAME = 'slack_channel';

export default [
  {
    group: SLACK_GROUP_NAME,
    label: Slack.SettingLabel.access_token,
    value: '',
    type: SettingType.secret,
  },
] as const satisfies ChannelSetting<typeof SLACK_CHANNEL_NAME>[];
