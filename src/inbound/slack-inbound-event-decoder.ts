/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ChannelInboundEvent,
  ChannelInboundEventContext,
  ChannelInboundEventDecoder,
} from '@hexabot-ai/api';
import { Injectable, Type } from '@nestjs/common';

import { SLACK_CHANNEL_NAME } from '../settings.schema';
import { Slack } from '../types';

import SlackAttachmentMessageInboundEvent from './events/messages/attachment.event';
import SlackPostbackInboundEvent from './events/messages/postback.event';
import SlackTextMessageInboundEvent from './events/messages/text.event';

const SLACK_MENTION_PATTERN = /<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g;

export class SlackInboundEventDecoder
  implements
    ChannelInboundEventDecoder<
      typeof SLACK_CHANNEL_NAME,
      ChannelInboundEvent<
        typeof SLACK_CHANNEL_NAME,
        Slack.IncomingPayload,
        Slack.ChannelAttrs
      >,
      Slack.ChannelAttrs
    >
{
  readonly channel: typeof SLACK_CHANNEL_NAME;

  constructor(channel: typeof SLACK_CHANNEL_NAME = SLACK_CHANNEL_NAME) {
    this.channel = channel;
  }

  createEvents(
    raw: unknown,
    channelAttrs: Slack.ChannelAttrs,
  ): Array<
    ChannelInboundEvent<
      typeof SLACK_CHANNEL_NAME,
      Slack.IncomingPayload,
      Slack.ChannelAttrs
    >
  > {
    const event = Slack.incomingPayloadSchema.parse(raw);

    if (event.type === 'event_callback') {
      return this.createEventCallbackEvents(event, channelAttrs);
    }

    if (event.type === 'block_actions') {
      const postback = this.createBlockActionEvent(event, channelAttrs);

      return postback ? [postback] : [];
    }

    return [];
  }

  private createEventCallbackEvents(
    event: Slack.EventCallback,
    channelAttrs: Slack.ChannelAttrs,
  ): Array<
    ChannelInboundEvent<
      typeof SLACK_CHANNEL_NAME,
      Slack.IncomingPayload,
      Slack.ChannelAttrs
    >
  > {
    if (!this.isSupportedMessageEvent(event) || this.isBotMessage(event)) {
      return [];
    }

    const events: Array<
      ChannelInboundEvent<
        typeof SLACK_CHANNEL_NAME,
        Slack.IncomingPayload,
        Slack.ChannelAttrs
      >
    > = [];
    const text = this.cleanText(event.event.text ?? '');

    if (text.length > 0) {
      events.push(
        new SlackTextMessageInboundEvent(
          this.createMessageContext(event, channelAttrs, 'text'),
          text,
        ),
      );
    }

    const files = event.event.files ?? [];
    const downloadableFiles = files.filter(
      (file) => !!file.url_private_download || !!file.url_private,
    );

    if (downloadableFiles.length > 0) {
      events.push(
        new SlackAttachmentMessageInboundEvent(
          this.createMessageContext(event, channelAttrs, 'files'),
          downloadableFiles,
        ),
      );
    }

    return events;
  }

  private createBlockActionEvent(
    event: Slack.BlockAction,
    channelAttrs: Slack.ChannelAttrs,
  ): ChannelInboundEvent<
    typeof SLACK_CHANNEL_NAME,
    Slack.IncomingPayload,
    Slack.ChannelAttrs
  > | null {
    const action = event.actions[0];

    if (!action || action.type !== 'button') {
      return null;
    }

    if (action.url && (!action.value || action.value === 'url')) {
      return null;
    }

    const payload = action.value ?? action.text?.text ?? '';

    if (!payload) {
      return null;
    }

    return new SlackPostbackInboundEvent(
      this.createActionContext(event, channelAttrs),
      payload,
      action.text?.text ?? payload,
    );
  }

  private createMessageContext(
    event: Slack.EventCallback,
    channelAttrs: Slack.ChannelAttrs,
    suffix: string,
  ): ChannelInboundEventContext<
    typeof SLACK_CHANNEL_NAME,
    Slack.IncomingPayload,
    Slack.ChannelAttrs
  > {
    const attrs = channelAttrs as unknown as Slack.ChannelAttrs;
    const messageTs = event.event.ts ?? event.event.event_ts ?? event.event_id;

    return new ChannelInboundEventContext(
      this.channel,
      event,
      channelAttrs,
      this.getOccurredAt(event.event.event_ts, event.event.ts),
      `${event.event_id}:${suffix}`,
      attrs.userId,
      attrs.conversationId,
    );
  }

  private createActionContext(
    event: Slack.BlockAction,
    channelAttrs: Slack.ChannelAttrs,
  ): ChannelInboundEventContext<
    typeof SLACK_CHANNEL_NAME,
    Slack.IncomingPayload,
    Slack.ChannelAttrs
  > {
    const attrs = channelAttrs as unknown as Slack.ChannelAttrs;
    const actionTs = event.actions[0]?.action_ts;
    const messageTs = event.message?.ts ?? actionTs ?? Date.now().toString();

    return new ChannelInboundEventContext(
      this.channel,
      event,
      channelAttrs,
      this.getOccurredAt(actionTs, messageTs),
      `action:${attrs.userId}:${messageTs}:${event.actions[0]?.value ?? ''}`,
      attrs.userId,
      attrs.conversationId,
    );
  }

  private isSupportedMessageEvent(event: Slack.EventCallback): boolean {
    if (event.type !== 'event_callback') {
      return false;
    }

    if (event.event.type === 'app_mention') {
      return true;
    }

    return (
      event.event.type === 'message' &&
      event.event.channel_type === 'im' &&
      (!event.event.subtype || event.event.subtype === 'file_share')
    );
  }

  private isBotMessage(event: Slack.EventCallback): boolean {
    if (event.event.bot_id || event.event.subtype === 'bot_message') {
      return true;
    }

    return (
      !!event.event.user &&
      event.authorizations?.some(
        (authorization) =>
          authorization.is_bot && authorization.user_id === event.event.user,
      ) === true
    );
  }

  private cleanText(text: string): string {
    return text.replace(SLACK_MENTION_PATTERN, '').trim();
  }

  private getOccurredAt(...candidates: Array<string | undefined>): Date {
    for (const candidate of candidates) {
      const date = this.parseSlackTimestamp(candidate);

      if (date) {
        return date;
      }
    }

    return new Date();
  }

  private parseSlackTimestamp(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const timestamp = Number(value);

    if (!Number.isFinite(timestamp)) {
      return null;
    }

    const date = new Date(timestamp * 1000);

    return Number.isNaN(date.getTime()) ? null : date;
  }
}

export function createSlackInboundEventDecoder(
  _channelName: string,
): Type<SlackInboundEventDecoder> {
  @Injectable()
  class BoundSlackInboundEventDecoder extends SlackInboundEventDecoder {
    constructor() {
      super(SLACK_CHANNEL_NAME);
    }
  }

  return BoundSlackInboundEventDecoder;
}

export default SlackInboundEventDecoder;
