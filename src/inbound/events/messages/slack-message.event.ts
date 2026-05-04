/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ChannelInboundEventContext,
  MessageInboundEvent,
} from '@hexabot-ai/api';

import { SLACK_CHANNEL_NAME } from '../../../settings.schema';
import { Slack } from '../../../types';

export abstract class SlackMessageInboundEvent extends MessageInboundEvent<
  typeof SLACK_CHANNEL_NAME,
  Slack.IncomingPayload,
  Slack.ChannelAttrs
> {
  protected constructor(
    context: ChannelInboundEventContext<
      typeof SLACK_CHANNEL_NAME,
      Slack.IncomingPayload,
      Slack.ChannelAttrs
    >,
    handler?: Parameters<
      MessageInboundEvent<typeof SLACK_CHANNEL_NAME>['setHandler']
    >[0],
  ) {
    super(context, handler);
  }

  override getRaw<T = Slack.IncomingPayload>(): T {
    return super.getRaw<T>();
  }
}

export default SlackMessageInboundEvent;
