/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import DEFAULT_SLACK_SETTINGS, { SLACK_CHANNEL_NAME, SLACK_CHANNEL_NAMESPACE } from './settings';
import { Slack } from './types';

declare global {
  interface Settings extends SettingTree<typeof DEFAULT_SLACK_SETTINGS> { }

  interface SubscriberChannelDict {
    [SLACK_CHANNEL_NAME]: {
      channelType: Slack.ChannelTypes,
    }
  }
}

declare module '@nestjs/event-emitter' {
  interface IHookExtensionsOperationMap {
    [SLACK_CHANNEL_NAMESPACE]: TDefinition<
      object,
      SettingMapByType<typeof DEFAULT_SLACK_SETTINGS>
    >;
  }
}
