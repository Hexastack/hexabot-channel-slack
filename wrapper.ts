/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { v4 as uuidv4 } from 'uuid';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import EventWrapper from '@/channel/lib/EventWrapper';
import {
  AttachmentForeignKey,
  AttachmentPayload,
  FileType,
} from '@/chat/schemas/types/attachment';
import {
  IncomingMessageType,
  StdEventType,
  StdIncomingMessage,
} from '@/chat/schemas/types/message';
import { Payload, PayloadType } from '@/chat/schemas/types/quick-reply';

import { SlackHandler } from './index.channel';
import { SLACK_CHANNEL_NAME } from './settings';
import { Slack } from './types';

type SlackEventAdapter = {
  eventType: StdEventType.unknown;
  messageType: never;
  raw: Slack.Event;
};

export default class SlackEventWrapper extends EventWrapper<
  SlackEventAdapter,
  Slack.BodyEvent,
  SlackHandler
> {
  _raw: Slack.Event;

  private eventType: StdEventType;

  private eventMessage: StdIncomingMessage;

  private messageType: IncomingMessageType;

  messagePayload: Payload | string | undefined;

  /**
   * Constructor; Channel's event wrapper
   *
   * @param handker - The channel's handler
   * @param event - The event to wrap
   */
  constructor(handler: SlackHandler, data: Slack.BodyEvent) {
    debugger;
    super(handler, data);
    const channelData = {
      [SLACK_CHANNEL_NAME]: { channel_id: this._raw.channel },
    };
    this.set('channelData', channelData);
  }

  _init(event: Slack.BodyEvent): void {
    this._raw = this.parseEvent(event);
  }

  isSlackIncomingEvent(data: Slack.BodyEvent): data is Slack.IncomingEvent {
    return (data as Slack.IncomingEvent).event !== undefined;
  }

  isSlackPayloadEvent(data: Slack.BodyEvent): data is Slack.PayloadEvent {
    return (data as Slack.PayloadEvent).payload !== undefined;
  }

  /**
   *  Parse the event data to a unified format
   *
   * @param data - The event data to parse
   * @returns The parsed event
   */
  private parseEvent(data: Slack.BodyEvent): Slack.Event {
    let data_event: Slack.Event;
    if (this.isSlackIncomingEvent(data)) {
      data_event = data.event;
      data_event.api_app_id = data.api_app_id;
    } else if (this.isSlackPayloadEvent(data)) {
      //if the event is a payload, we receive a string
      const payload = JSON.parse(data.payload) as Slack.IncomingPayload;
      data_event = {
        actions: payload.actions,
        channel: payload.channel?.id,
        type: payload.type,
        client_msg_id: payload.message_ts,
        user: payload.user.id,
        ts: payload.action_ts || payload.actions[0].action_ts,
        team: payload.team.id,
        channel_type: 'im',
        api_app_id: payload.api_app_id,
        event_ts: payload.action_ts || payload.actions[0].action_ts,
        response_url: payload.response_url,
        original_message: payload.original_message,
      };
    } else if (data.command) {
      //TODO: not tested
      //if the event is a slash command event
      data_event = {
        api_app_id: data.api_app_id,
        type: Slack.SlackType.incoming_message,
        text: data.command + ' ' + data.text,
        user: data.user_id,
        team: data.team_id,
        channel: data.channel_id,
        channel_type: 'im',
      };
    }

    return data_event;
  }

  /**
   * Generate a unique identifier for the event
   *
   * @returns A unique identifier for the event
   */
  private _generateId(): string {
    return 'slack-' + uuidv4();
  }

  /**
   * Returns the message's id
   *
   * @returns The message's id
   */
  getId(): string {
    if (!this._raw.client_msg_id) {
      debugger;
      this._raw.client_msg_id = this._generateId();
    }
    return this._raw.client_msg_id;
  }

  /**
   * Returns event sender id (user's id) in Slack
   *
   * @returns
   */
  getSenderForeignId(): string {
    return this._raw.user || null;
  }

  getRecipientForeignId(): string {
    return this.getEventType() === StdEventType.echo ? this._raw.user : null;
  }

  _resolveEventType(): StdEventType {
    debugger;
    const msg = this._raw;
    if (msg.bot_id) {
      return StdEventType.echo;
    } else if (
      msg.type === Slack.SlackType.interactive_message ||
      msg.type === Slack.SlackType.block_actions ||
      (msg.type == Slack.SlackType.incoming_message &&
        ((msg.channel_type === 'channel' &&
          msg.text &&
          msg.text.includes('<@)' + 'sails.settings.slack_user_id' + '>')) ||
          msg.channel_type === 'im'))
    ) {
      return StdEventType.message;
    } else {
      return StdEventType.unknown;
    }
  }

  /**
   * Returns the type of event received
   *
   * @returns The standardized event type
   */
  getEventType(): StdEventType {
    //TODO: to test all the cases
    if (!this.eventType) {
      this.eventType = this._resolveEventType();
    }
    return this.eventType;
  }

  /**
   * Check if the event is a response to a quick reply (button)
   * @returns True if the event is a quick reply
   */
  isQuickReplies(): boolean {
    return (
      this._raw.original_message?.attachments?.[0]?.callback_id ===
      Slack.CallbackId.quick_replies
    );
  }

  _resolveMessageType(): IncomingMessageType {
    if (this.getEventType() !== StdEventType.message)
      IncomingMessageType.unknown;

    const msg = this._raw;
    if (
      msg.original_message?.attachments?.[0]?.callback_id ===
      Slack.CallbackId.quick_replies
    ) {
      return IncomingMessageType.quick_reply;
    }
    if (msg.actions) {
      return IncomingMessageType.postback;
    } else if (msg.files && msg.files.length >= 1) {
      return IncomingMessageType.attachments;
    } else if (msg.text || msg.attachments || msg.blocks) {
      return IncomingMessageType.message;
    }
    return IncomingMessageType.unknown;
  }

  /**
   * Returns the type of message received
   *
   * @returns The type of message
   */
  getMessageType(): IncomingMessageType {
    if (!this.messageType) {
      this.messageType = this._resolveMessageType();
    }
    return this.messageType;
  }

  _resolvePayload(): Payload | string | undefined {
    //TODO: to optimze
    if (this.getEventType() !== StdEventType.message) return;

    const eventType = this.getMessageType();
    switch (eventType) {
      case IncomingMessageType.postback:
        return this._raw.actions[0].value;
      case IncomingMessageType.quick_reply:
        return this._raw.actions[0].value;
      case IncomingMessageType.attachments:
        if (
          (<Slack.Event>this._raw).files &&
          (<Slack.Event>this._raw).files[0]
        ) {
          const attachment: Slack.File = (<Slack.Event>this._raw).files[0];
          const mimetype: boolean | string = attachment.mimetype
            ? attachment.mimetype
            : /*mime.lookup(*/ attachment.url_private; /*)*/ //TODO: to implement
          return {
            type: PayloadType.attachments,
            attachments: {
              type: <FileType>(<unknown>Attachment.getTypeByMime(mimetype)),
              payload: {
                url: attachment.url_private,
              },
            },
          };
        }
    }
  }

  /**
   * Returns payload whenever user clicks on a button/quick_reply or sends an attachment
   *
   * @returns The payload content
   */
  getPayload(): Payload | string | undefined {
    if (!this.messagePayload) {
      this.messagePayload = this._resolvePayload();
    }
    return this.messagePayload;
  }

  _resolveMessage(): StdIncomingMessage {
    const type: IncomingMessageType = this.getMessageType();
    const msg = <Slack.Event>this._raw;
    switch (type) {
      case IncomingMessageType.message:
        return {
          text: msg.text,
        };

      case IncomingMessageType.quick_reply:
        return {
          postback: msg.actions[0].name,
          text: msg.actions[0].value,
        };
      case IncomingMessageType.postback:
        return {
          postback: msg.actions[0].text.text,
          text: msg.actions[0].value,
        };

      case IncomingMessageType.attachments:
        const attachments: Array<Slack.File> = (<Slack.Event>this._raw).files;
        let serialized_text: string = 'attachment:';

        const file_path = attachments[0].url_private;
        let mimetype: boolean | string = attachments[0].mimetype
          ? attachments[0].mimetype
          : /*mime.lookup(*/ file_path; /*);*/ //TODO: to implement

        serialized_text += `${Attachment.getTypeByMime(mimetype)}:${file_path}`;
        const stdAttachments /*: Array<AttachmentPayload>*/ = attachments.map(
          (att) => {
            mimetype = att.mimetype
              ? att.mimetype
              : /*mime.lookup(*/ att.url_private /*)*/; //TODO: to implement
            return {
              type: Object.values(FileType).includes(
                <FileType>(<unknown>Attachment.getTypeByMime(mimetype)),
              )
                ? <FileType>(<unknown>Attachment.getTypeByMime(mimetype))
                : FileType.unknown,
              payload: {
                url: att.url_private,
              },
            };
          },
        );
        return {
          type: PayloadType.attachments,
          serialized_text,
          attachment:
            stdAttachments.length === 1 ? stdAttachments[0] : stdAttachments,
        };
    }
  }

  shouldBeIgnored(): boolean {
    const msg = this._raw;
    return (
      msg.type === Slack.SlackType.block_actions &&
      msg.actions[0].value === 'url'
    );
  }

  /**
   * Returns the message in a standardized format
   *
   * @returns The received message
   */
  getMessage(): StdIncomingMessage {
    if (!this.eventMessage) {
      this.eventMessage = this._resolveMessage();
    }
    return this.eventMessage;
  }

  /**
   * Returns the list of received attachments
   *
   * @returns Received attachments message
   */
  getAttachments(): AttachmentPayload<AttachmentForeignKey>[] {
    const message: StdIncomingMessage = this.getMessage();
    return 'attachment' in message ? [].concat(message.attachment) : [];
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
    return 0; //TODO: to implement??
  }

  /**
   * Returns the response URL
   *
   * @returns The response URL
   */
  getResponseUrl(): string {
    return this._raw.response_url;
  }
}
