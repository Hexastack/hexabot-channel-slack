/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  IncomingMessageType,
  PayloadType,
  StdEventType,
} from '@hexabot-ai/types';

import { SlackInboundEventDecoder } from '../inbound';
import {
  SlackAttachmentMessageInboundEvent,
  SlackPostbackInboundEvent,
  SlackTextMessageInboundEvent,
} from '../inbound/events';
import { SLACK_CHANNEL_NAME } from '../settings.schema';
import { Slack } from '../types';

const attrs: Slack.ChannelAttrs = {
  teamId: 'T1',
  appId: 'A1',
  conversationId: 'D1',
  conversationType: 'im',
  userId: 'U1',
  messageTs: '1710000000.000000',
};

const baseEventCallback = {
  type: 'event_callback',
  api_app_id: 'A1',
  team_id: 'T1',
  event_id: 'Ev1',
  event_time: 1710000000,
  event: {
    type: 'message',
    channel: 'D1',
    channel_type: 'im',
    user: 'U1',
    text: 'hello',
    ts: '1710000000.000000',
    event_ts: '1710000000.000000',
  },
} satisfies Slack.EventCallback;

const expectSlackEvent = <T>(
  event: unknown,
  eventClass: abstract new (...args: any[]) => T,
): T => {
  expect(event).toBeInstanceOf(eventClass);

  return event as T;
};

describe('SlackInboundEventDecoder', () => {
  const decoder = new SlackInboundEventDecoder(SLACK_CHANNEL_NAME);

  it('decodes DM text messages', () => {
    const [event] = decoder.createEvents(baseEventCallback, attrs);
    const messageEvent = expectSlackEvent(event, SlackTextMessageInboundEvent);

    expect(messageEvent.getEventType()).toBe(StdEventType.message);
    expect(messageEvent.getSenderForeignId()).toBe('U1');
    expect(messageEvent.getChannelAttrs()).toEqual(attrs);
    expect(messageEvent.getMessage()).toEqual({
      type: IncomingMessageType.text,
      data: { text: 'hello' },
    });
  });

  it('strips bot mentions from app mentions', () => {
    const [event] = decoder.createEvents(
      {
        ...baseEventCallback,
        event_id: 'Ev2',
        event: {
          ...baseEventCallback.event,
          type: 'app_mention',
          channel: 'C1',
          channel_type: 'channel',
          text: '<@U999> deploy status',
        },
      },
      {
        ...attrs,
        conversationId: 'C1',
        conversationType: 'channel',
      },
    );
    const messageEvent = expectSlackEvent(event, SlackTextMessageInboundEvent);

    expect(messageEvent.getText()).toBe('deploy status');
  });

  it('splits combined text and files into separate events', () => {
    const events = decoder.createEvents(
      {
        ...baseEventCallback,
        event_id: 'Ev3',
        event: {
          ...baseEventCallback.event,
          text: 'see file',
          subtype: 'file_share',
          files: [
            {
              id: 'F1',
              name: 'report.pdf',
              url_private_download: 'https://files.slack.com/report.pdf',
            },
          ],
        },
      },
      attrs,
    );
    const textEvent = expectSlackEvent(events[0], SlackTextMessageInboundEvent);
    const attachmentEvent = expectSlackEvent(
      events[1],
      SlackAttachmentMessageInboundEvent,
    );

    expect(events).toHaveLength(2);
    expect(textEvent.getText()).toBe('see file');
    expect(attachmentEvent.getRemoteFiles()).toEqual([
      expect.objectContaining({ id: 'F1' }),
    ]);
  });

  it('decodes non-URL button postbacks', () => {
    const [event] = decoder.createEvents(
      {
        type: 'block_actions',
        api_app_id: 'A1',
        team: { id: 'T1' },
        user: { id: 'U1', team_id: 'T1' },
        channel: { id: 'D1' },
        message: { ts: '1710000001.000000' },
        actions: [
          {
            type: 'button',
            value: 'PAYLOAD_1',
            text: { type: 'plain_text', text: 'Pick' },
            action_ts: '1710000001.000000',
          },
        ],
      },
      attrs,
    );
    const messageEvent = expectSlackEvent(event, SlackPostbackInboundEvent);

    expect(messageEvent.getPayload()).toBe('PAYLOAD_1');
    expect(messageEvent.getMessage()).toEqual({
      type: IncomingMessageType.postback,
      data: {
        text: 'Pick',
        payload: 'PAYLOAD_1',
      },
    });
  });

  it('ignores URL-only button actions', () => {
    expect(
      decoder.createEvents(
        {
          type: 'block_actions',
          api_app_id: 'A1',
          team: { id: 'T1' },
          user: { id: 'U1', team_id: 'T1' },
          actions: [
            {
              type: 'button',
              value: 'url',
              url: 'https://example.com',
              text: { type: 'plain_text', text: 'Open' },
            },
          ],
        },
        attrs,
      ),
    ).toEqual([]);
  });

  it('ignores bot and self-authored messages', () => {
    expect(
      decoder.createEvents(
        {
          ...baseEventCallback,
          event_id: 'Ev4',
          event: {
            ...baseEventCallback.event,
            bot_id: 'B1',
          },
        },
        attrs,
      ),
    ).toEqual([]);

    expect(
      decoder.createEvents(
        {
          ...baseEventCallback,
          event_id: 'Ev5',
          authorizations: [
            {
              team_id: 'T1',
              user_id: 'U1',
              is_bot: true,
              is_enterprise_install: false,
            },
          ],
        },
        attrs,
      ),
    ).toEqual([]);
  });
});
