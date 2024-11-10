/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { ChannelSetting } from '@/channel/types';
import { SettingType } from '@/setting/schemas/types';

export const SLACK_CHANNEL_NAME = 'slack-channel';

export const SLACK_GROUP_NAME = 'slack_channel';

export enum SettingLabel {
  access_token = 'access_token',
  signing_secret = 'signing_secret',
}

export default [
  {
    group: SLACK_GROUP_NAME,
    label: SettingLabel.access_token,
    value: '',
    type: SettingType.secret,
  },
  {
    group: SLACK_GROUP_NAME,
    label: SettingLabel.signing_secret,
    value: '',
    type: SettingType.secret,
  },
] as const satisfies ChannelSetting<typeof SLACK_CHANNEL_NAME>[];
