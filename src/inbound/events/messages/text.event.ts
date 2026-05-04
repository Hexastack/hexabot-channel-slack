/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ChannelInboundEventContext } from '@hexabot-ai/api';
import { IncomingMessageType, StdIncomingMessage } from '@hexabot-ai/types';

import { SLACK_CHANNEL_NAME } from '../../../settings.schema';
import { Slack } from '../../../types';

import SlackMessageInboundEvent from './slack-message.event';

export class SlackTextMessageInboundEvent extends SlackMessageInboundEvent {
  constructor(
    context: ChannelInboundEventContext<
      typeof SLACK_CHANNEL_NAME,
      Slack.IncomingPayload,
      Slack.ChannelAttrs
    >,
    private readonly text: string,
  ) {
    super(context);
  }

  override getMessageType(): IncomingMessageType {
    return IncomingMessageType.text;
  }

  override toStdIncomingMessage(): StdIncomingMessage {
    return {
      type: IncomingMessageType.text,
      data: {
        text: this.text,
      },
    };
  }
}

export default SlackTextMessageInboundEvent;
