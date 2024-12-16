/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { Attachment } from '@/attachment/schemas/attachment.schema';
import EventWrapper from '@/channel/lib/EventWrapper';
import {
  AttachmentForeignKey,
  AttachmentPayload,
} from '@/chat/schemas/types/attachment';
import {
  IncomingMessageType,
  PayloadType,
  StdEventType,
  StdIncomingMessage,
} from '@/chat/schemas/types/message';
import { Payload } from '@/chat/schemas/types/quick-reply';

import * as SlackTypes from '@slack/types';
import { SlackHandler } from './index.channel';
import { SLACK_CHANNEL_NAME } from './settings';
import { Slack } from './types';

type SlackEventAdapter = {
  eventType: StdEventType.unknown;
  messageType: never;
  raw: Slack.IncomingEvent;
} | {
  eventType: StdEventType.echo;
  messageType: IncomingMessageType.message;
  raw: Slack.EventCallback<Slack.SupportedEvent>
} | {
  eventType: StdEventType.message;
  messageType: IncomingMessageType.message;
  raw: Slack.EventCallback<Slack.SupportedEvent>
} | {
  eventType: StdEventType.message;
  messageType: IncomingMessageType.attachments;
  raw: Slack.EventCallback<Slack.SupportedEvent>
} | {
  eventType: StdEventType.message;
  messageType: IncomingMessageType.postback;
  raw: Slack.BlockAction<Slack.ButtonAction>
};

export default class SlackEventWrapper extends EventWrapper<
  SlackEventAdapter,
  Slack.IncomingEvent,
  typeof SLACK_CHANNEL_NAME
> {
  private readonly appId: string;

  /**
   * Constructor; Channel's event wrapper
   *
   * @param handker - The channel's handler
   * @param event - The event to wrap
   */
  constructor(handler: SlackHandler, data: Slack.IncomingEvent) {
    super(handler, data, {
      channelType: SlackEventWrapper.getChannelType(data),
    });
  }

  _init(e: Slack.IncomingEvent) {
    if (e.type === 'block_actions') {
      this._adapter.eventType = StdEventType.message;
      this._adapter.messageType = IncomingMessageType.postback;
    } else if (e.type === 'event_callback') {
      this._adapter.eventType = e.event.bot_id ? StdEventType.echo : StdEventType.message;
      if (e.event.files) {
        this._adapter.messageType = IncomingMessageType.attachments;
      } else {
        this._adapter.messageType = IncomingMessageType.message;
      }
    } else {
      this._adapter.eventType = StdEventType.unknown;
    }
    this._adapter.raw = e;
  }

  static getChannelType(e: Slack.IncomingEvent): Slack.ChannelTypes {
    if (e.type === 'block_actions') {
      return e.channel.id.startsWith('D') ? 'im' : 'channel';
    } else if (e.type === 'event_callback') {
      const event = e.event
      if (event.type === 'message') {
        return event.channel_type;
      } else {
        // App mention case
        return event.channel.startsWith('D') ? 'im' : 'channel';
      }
    }
  }

  /**
   * Returns the message's id
   *
   * @returns The message's id
   */
  getId(): string {
    if (this._adapter.raw.type === 'event_callback') {
      return this._adapter.raw.event.ts;
    } else {
      return this._adapter.raw.message.ts;
    }
  }

  /**
   * Returns the user's ID (To be used only in case of a direct message)
   *
   * @returns The user's ID
   */
  getUserForeignId(): string {
    const { channelType: channelType } = this.getChannelData();

    if (channelType === 'im') {
      const e = this._adapter.raw;

      if (e.type === 'block_actions') {
        return e.user.id;
      } else if (e.type === 'event_callback') {
        return e.event.user;
      }
    }

    throw new Error('Unable to extract user id!')
  }

  /**
   * Returns the conversation ID, whether it's a direct message, a group or a channel message
   *
   * @returns The convsersation ID (direct message, group or channel)
   */
  getSenderForeignId(): string {
    const e = this._adapter.raw;

    if (e.type === 'block_actions') {
      return e.channel.id;
    } else if (e.type === 'event_callback') {
      return e.event.channel;
    } else {
      throw new Error('Unable to extract conversation id!')
    }
  }

  /**
   * Returns the conversation's ID, whether it's a direct message, a group or a channel message
   *
   * @returns The convsersation ID (direct message, group or channel)
   */
  getRecipientForeignId(): string {
    const e = this._adapter.raw;

    if (e.type === 'block_actions') {
      return e.channel.id;
    } else if (e.type === 'event_callback') {
      return e.event.channel;
    } else {
      throw new Error('Unable to extract channel id!')
    }
  }

  /**
   * Returns payload whenever user clicks on a button/quick_reply or sends an attachment
   *
   * @returns The payload content
   */
  getPayload(): Payload | string | undefined {
    if (this._adapter.eventType === StdEventType.message) {
      if (this._adapter.messageType === IncomingMessageType.postback) {
        return this._adapter.raw.actions[0]?.value
      }
      else if (this._adapter.messageType === IncomingMessageType.attachments) {
        const e = this._adapter.raw.event as SlackTypes.GenericMessageEvent;
        if (e.files && e.files[0]) {
          const attachment = e.files[0];
          const mimetype: boolean | string = attachment.mimetype;

          return {
            type: PayloadType.attachments,
            attachments: {
              type: Attachment.getTypeByMime(mimetype),
              payload: {
                url: attachment.url_private,
              },
            },
          };
        } 
      }
    }
    return undefined
  }

  removeSlackMentions(text: string): string {
    return text.replace(/<@U[A-Z0-9]{8,11}(?:\|[^>]+)?>/g, '').trim();
  }

  /**
   * Returns the message in a standardized format
   *
   * @returns The received message
   */
  getMessage(): StdIncomingMessage {
    switch (this._adapter.messageType) {
      case IncomingMessageType.message:
        return {
          text: this.removeSlackMentions(this._adapter.raw.event.text),
        };

      case IncomingMessageType.postback:
        return {
          text: this._adapter.raw.actions[0].text.text,
          postback: this._adapter.raw.actions[0].value,
        };

      case IncomingMessageType.attachments:
        const attachments = this._adapter.raw.event.files as unknown as Slack.UploadedFile[];
        let serialized_text = 'attachment:';

        const file_path = attachments[0].url_private;
        const mimetype = attachments[0].mimetype;

        serialized_text += `${Attachment.getTypeByMime(mimetype)}:${file_path}`; //TODO: ?? serialized_text only for the first attachment??
        const stdAttachments = attachments.map((att) => ({
          type: Attachment.getTypeByMime(att.mimetype),
          payload: {
            url: att.url_private,
          },
        }));

        return {
          type: PayloadType.attachments,
          serialized_text,
          attachment: stdAttachments,
        };
      case IncomingMessageType.postback:
        throw new Error('Unable to extract message')
    }
  }

  /**
   * Returns the list of received attachments
   *
   * @returns Received attachments message
   */
  getAttachments(): AttachmentPayload<AttachmentForeignKey>[] {
    const message: StdIncomingMessage = this.getMessage();
    return message && 'attachment' in message ? [].concat(message.attachment) : [];
  }

  /**
   * Returns the list of delivered messages
   *
   * @returns Array of message ids
   */
  getDeliveredMessages(): string[] {
    return []; //TODO: to implement??
  }

  /**
   * Returns the message's watermark
   *
   * @returns The message's watermark
   */
  getWatermark(): number {
    if (this._adapter.messageType === IncomingMessageType.message) {
      return parseInt(this._adapter.raw.event.event_ts)
    } else if (this._adapter.messageType === IncomingMessageType.postback) {
      return parseInt(this._adapter.raw.actions[0]?.action_ts)
    }
    return 0;
  }

  /**
   * Returns the response URL
   *
   * @returns The response URL
   */
  getResponseUrl(): string {
    if (this._adapter.messageType === IncomingMessageType.postback) {
      return this._adapter.raw.response_url
    }
    return undefined
  }
}
