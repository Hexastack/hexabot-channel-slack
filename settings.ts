import { SettingCreateDto } from '@/setting/dto/setting.dto';
import { SettingType } from '@/setting/schemas/types';

import { Slack } from './types';

export const SLACK_CHANNEL_NAME = 'slack';

export const DEFAULT_SLACK_SETTINGS: SettingCreateDto[] = [
  {
    group: SLACK_CHANNEL_NAME,
    label: Slack.SettingLabel.access_token,
    value: '',
    type: SettingType.secret,
    weight: 1,
  },
];
