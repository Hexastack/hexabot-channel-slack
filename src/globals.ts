/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { SLACK_CHANNEL_NAME } from './settings.schema';
import { Slack } from './types';

declare global {
  interface SubscriberChannelDict {
    [SLACK_CHANNEL_NAME]: Slack.ChannelAttrs;
  }
}

export {};
