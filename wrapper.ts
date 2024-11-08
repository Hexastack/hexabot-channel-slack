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
import ChannelHandler from '@/channel/lib/Handler';
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

import { Slack } from './types';

type SlackEventAdapter = {
  eventType: StdEventType.unknown;
  messageType: never;
  raw: Slack.BodyEvent;
};

export default class SlackEventWrapper extends EventWrapper<
  SlackEventAdapter,
  Slack.Event
> {
  _raw: Slack.Event;

  /**
   * @param handker - The channel's handler
   * @param event - The event to wrap
   */
  constructor(handler: ChannelHandler, data: Slack.BodyEvent) {
    debugger;
    super(handler, data as any); //TODO: remove any
    let data_event: Slack.Event;
    if ((<Slack.IncomingEvent>data).event) {
      data_event = (<Slack.IncomingEvent>data).event;
      data_event.api_app_id = (<Slack.IncomingEvent>data).api_app_id;
    }
    if ((<Slack.PayloadEvent>data).payload) {
      //if the event is a payload, we receive a string
      const payload = JSON.parse(
        (<Slack.PayloadEvent>data).payload,
      ) as Slack.IncomingPayload;
      data_event = {
        actions: payload.actions,
        channel: payload.channel.id,
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
    } else if ((<Slack.CommandEvent>data).command) {
      //if the event is a slash command event
      const datac: Slack.CommandEvent = <Slack.CommandEvent>data;
      data_event = {
        type: Slack.SlackType.incoming_message,
        text: datac.command + ' ' + datac.text,
        user: datac.user_id,
        team: datac.team_id,
        channel: datac.channel_id,
        channel_type: 'im',
      } as Slack.Event; //TODO: to remove the any
    }

    this._raw = data_event;
  }

  _init(event: Slack.Event): void {
    ////debugger;
  }

  private _generateId(): string {
    return 'slack-' + uuidv4();
  }

  getId(): string {
    return this._raw.client_msg_id ?? this._generateId();
  }

  getSenderForeignId(): string {
    if (this.getEventType() === StdEventType.echo) {
      console.error(
        'Not emplemented: getSenderForeignId called with event type echo ',
      );
    }

    return this._raw.user || null;
  }

  getRecipientForeignId(): string {
    if (this.getEventType() === StdEventType.echo) return null;
    ////debugger;
    return null;
  }

  getEventType(): StdEventType {
    //TODO: to test all the cases
    const msg = this._raw;

    if (msg.user == 'sails.settings.slack_user_id ???') {
      //TODO: to implement
      ////debugger;
      throw new Error('Method not implemented.');
    }
    if (msg.app_id && msg.app_id && msg.app_id === msg.api_app_id) {
      //debugger;
      return StdEventType.echo;
    }

    if (
      ((msg.type === Slack.SlackType.interactive_message ||
        msg.type === Slack.SlackType.block_actions) &&
        msg.actions[0].value !== 'url') ||
      (msg.type == Slack.SlackType.incoming_message &&
        ((msg.channel_type === 'channel' &&
          msg.text &&
          msg.text.includes('<@)' + 'sails.settings.slack_user_id' + '>')) ||
          msg.channel_type === 'im'))
    ) {
      return StdEventType.message;
    }
    return StdEventType.unknown;
  }

  isQuickReplies(): boolean {
    return (
      this._raw.original_message?.attachments?.[0]?.callback_id ===
      Slack.CallbackId.quick_replies
    );
  }

  getMessageType(): IncomingMessageType {
    if (
      [StdEventType.echo, StdEventType.message].indexOf(this.getEventType()) !==
      -1
    ) {
      const msg = <Slack.Event>this._raw;
      if (msg.actions) {
        return IncomingMessageType.postback;
      } else if (msg.files && msg.files.length >= 1) {
        return IncomingMessageType.attachments;
      } else if (msg.text || msg.attachments || msg.blocks) {
        return IncomingMessageType.message;
      }
    }
    return IncomingMessageType.unknown;
  }

  getPayload(): Payload | string | undefined {
    ////debugger;
    if (this.getEventType() === StdEventType.message) {
      const eventType = this.getMessageType();
      switch (eventType) {
        case IncomingMessageType.postback:
          return (<Slack.Event>this._raw).actions[0].value;
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
  }

  getMessage() {
    const type: IncomingMessageType = this.getMessageType();
    let message: StdIncomingMessage;
    const msg = <Slack.Event>this._raw;
    switch (type) {
      case IncomingMessageType.message:
        message = {
          text: msg.text,
        };
        break;

      case IncomingMessageType.postback:
        message = {
          postback: msg.actions[0].name,
          text: msg.actions[0].value,
        };
        break;

      case IncomingMessageType.attachments:
        //debugger;
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
        message = {
          type: PayloadType.attachments,
          serialized_text,
          attachment:
            stdAttachments.length === 1 ? stdAttachments[0] : stdAttachments,
        };
        break;
    }
    return message;
  }

  getAttachments(): AttachmentPayload<AttachmentForeignKey>[] {
    const message: StdIncomingMessage = this.getMessage();
    return 'attachment' in message ? [].concat(message.attachment) : [];
  }

  getDeliveredMessages(): string[] {
    return []; //TODO: to implement??
  }

  getWatermark(): number {
    return 0; //TODO: to implement??
  }

  getResponseUrl(): string {
    return this._raw.response_url;
  }
}
