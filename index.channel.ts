import { text } from 'stream/consumers';

import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { ChannelService } from '@/channel/channel.service';
import EventWrapper from '@/channel/lib/EventWrapper';
import ChannelHandler from '@/channel/lib/Handler';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import {
  Button,
  PostBackButton,
  WebUrlButton,
} from '@/chat/schemas/types/button';
import {
  StdOutgoingMessage,
  StdOutgoingEnvelope,
  OutgoingMessageFormat,
  StdOutgoingTextMessage,
  StdOutgoingQuickRepliesMessage,
  StdOutgoingButtonsMessage,
} from '@/chat/schemas/types/message';
import { BlockOptions } from '@/chat/schemas/types/options';
import { LoggerService } from '@/logger/logger.service';
import { NlpService } from '@/nlp/services/nlp.service';
import { SettingService } from '@/setting/services/setting.service';
import { blocks } from '@/utils/test/fixtures/block';
import { SocketRequest } from '@/websocket/utils/socket-request';
import { SocketResponse } from '@/websocket/utils/socket-response';

import { SLACK_CHANNEL_NAME } from './settings';
import { slackApi } from './slack-api';
import { Slack } from './types';
import SlackEventWrapper from './wrapper';

@Injectable()
export class SlackHandler extends ChannelHandler {
  private readonly api = new slackApi();

  constructor(
    settingService: SettingService,
    channelService: ChannelService,
    nlpService: NlpService,
    logger: LoggerService,
    protected readonly eventEmitter: EventEmitter2,
    protected readonly httpService: HttpService,
  ) {
    super(settingService, channelService, nlpService, logger);
  }

  getChannel(): string {
    return SLACK_CHANNEL_NAME;
  }

  async init(): Promise<void> {
    this.logger.debug('Slack Channel Handler: Initializing...');
  }

  handle(req: Request, res: Response) {
    debugger;
    this.logger.debug('Slack Channel Handler: Handling request...');
    const data = req.body;

    console.log('SlackHandler.handle called, data: ', data); //TODO: to remove
    if (data.type && data.type === 'url_verification') {
      this.logger.debug('Slack Channel Handler: Handling url_verification...');
      return res.status(200).send(data.challenge);
    }

    try {
      const event = new SlackEventWrapper(this, data);
      event.set('mid', this._generateId());
      const type = event.getEventType();

      if (type) {
        this.eventEmitter.emit('hook:chatbot:' + type, event);
      } else {
        this.logger.error(
          'Slack Channel Handler: Webhook received unknown event',
          event,
        );
      }
    } catch (error) {
      this.logger.error(
        'Slack Channel Handler: Something went wrong while handling events',
        error,
      );
    }

    return res.status(200).json({ success: true });
  }

  //TODO: duplicate method
  private _generateId(): string {
    return 'slack-' + uuidv4();
  }

  _textFormat(message: StdOutgoingTextMessage, options?: any) {
    return {
      text: message.text,
    };
  }

  _quickRepliesFormat(message: StdOutgoingQuickRepliesMessage, options?: any) {
    if (true) {
      //Buttons with text
      const actions: Array<Slack.Button> = message.quickReplies.map((btn) => {
        const format_btn: Slack.Button = {
          name: btn.title,
          text: btn.title,
          type: 'button',
          value: btn.payload,
        };
        return format_btn;
      });

      return {
        attachments: [
          {
            text: message.text,
            actions,
            callback_id: 'slack_replies_' + actions[0].value,
          },
        ],
      };
    } else {
      const textSection = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'This is a section block with a button.',
        },
      };
      //Buttons without text
      //TODO: to ask, is this still possible
      const elements = message.quickReplies.map((btn) => {
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: btn.title,
            emoji: true,
          },
          value: btn.payload,
        };
      });
      //.slice(0, 3); //TODO: why slice??
      return {
        blocks: [textSection, { type: 'actions', elements }],
      };
    }
  }

  _buttonsFormat(
    message: StdOutgoingButtonsMessage,
    options?: any,
    ...args: any
  ) {
    debugger;
    const actions: Array<Slack.Button> = message.buttons
      .map((btn: Button) => {
        debugger;

        let format_btn: Slack.Button;
        if ((<WebUrlButton>btn).url) {
          format_btn = {
            name: btn.title,
            text: btn.title,
            type: 'button',
            value: 'url',
            url: (<WebUrlButton>btn).url,
          };
        } else {
          format_btn = {
            name: btn.title,
            text: btn.title,
            type: 'button',
            value: (<PostBackButton>btn).payload,
          };
        }
        return format_btn;
      })
      .slice(0, 3);
    return {
      attachments: [
        {
          text: message.text,
          actions,
          callback_id: 'slack_buttons_' + actions[0].value,
        },
      ],
    };
  }

  _attachmentFormat(message: StdOutgoingMessage, options?: any) {
    debugger;
    throw new Error('Method not implemented.');
  }

  _formatElements(data: any[], options: any, ...args: any): any[] {
    const fields = options.content.fields;
    const buttons = options.content.buttons;
    //To build a list :
    const blocks: Array<Slack.KnownBlock> = [{ type: 'divider' }];
    data.forEach((item) => {
      const text = item[fields.subtitle]
        ? '*' + item[fields.title] + '*\n' + item[fields.subtitle]
        : '*' + item[fields.title] + '*';
      //Block containing the title and subtitle and image
      const main_block: Slack.SectionBlock = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      };
      if (item[fields.image_url])
        main_block.accessory = {
          type: 'image',
          image_url: item[fields.image_url].payload.url,
          alt_text: item[fields.title],
        };
      blocks.push(main_block);
      //Array of elements : Buttons
      const elements = [];
      buttons.forEach((button: Button, index) => {
        const btn = { ...button };
        // Set custom title for first button if provided
        if (index === 0 && fields.action_title && item[fields.action_title]) {
          btn.title = item[fields.action_title];
        }
        if (button.type === 'web_url') {
          // Get built-in or an external URL from custom field
          const urlField = fields.url;
          btn.url = urlField && item[urlField] ? item[urlField] : item.getUrl();
          if (!btn.url.startsWith('http')) {
            btn.url = 'https://' + btn.url;
          }
          //button with url
          elements.push({
            type: 'button',
            text: {
              type: 'plain_text',
              text: btn.title,
              emoji: true,
            },
            value: 'url',
            url: btn.url,
          });
        } else {
          //button without url
          btn.payload = btn.title + ':' + item.getPayload();
          elements.push({
            type: 'button',
            text: {
              type: 'plain_text',
              text: btn.title,
              emoji: true,
            },
            value: btn.payload,
          });
        }
      });
      blocks.push({
        type: 'actions',
        elements,
      });
      blocks.push({ type: 'divider' });
    });
    return blocks;
  }

  _listFormat(message: StdOutgoingMessage, options: any, ...args: any) {
    debugger;
    throw new Error('Method not implemented.');
  }

  _carouselFormat(message: StdOutgoingMessage, options: any, ...args: any) {
    debugger;
    throw new Error('Method not implemented.');
  }

  async sendMessage(
    event: SlackEventWrapper,
    envelope: StdOutgoingEnvelope,
    options: any,
    context: any,
  ): Promise<{ mid: string }> {
    //debugger;
    const message = this._formatMessage(envelope, options);
    await this.api.sendMessage(message, event.getSenderForeignId());
    return { mid: this._generateId() };
  }

  async getUserData(
    event: EventWrapper<any, any>,
  ): Promise<SubscriberCreateDto> {
    //debugger;
    const user = await this.api.getUserInfo(event.getSenderForeignId());

    const profile = user.profile;
    return {
      foreign_id: user.id,
      first_name:
        profile.first_name || profile.display_name || profile.real_name,
      last_name: profile.last_name || profile.display_name || profile.real_name,
      timezone: Math.floor(user.tz_offset / 3600), //not sure
      gender: 'Unknown',
      channel: {
        name: this.getChannel(),
      },
      assignedAt: null,
      assignedTo: null,
      labels: [],
      locale: 'en', //TODO: to check
      language: 'en', //TODO: to check
      country: '',
      lastvisit: new Date(),
      retainedFrom: new Date(),
    };
  }

  _formatMessage(envelope: StdOutgoingEnvelope, options: BlockOptions): any {
    //debugger;
    //TODO: Why is this method not in ChannelHandler?
    //TODO: update return type
    switch (envelope.format) {
      case OutgoingMessageFormat.attachment:
        return this._attachmentFormat(envelope.message, options);
      case OutgoingMessageFormat.buttons:
        return this._buttonsFormat(envelope.message, options);
      case OutgoingMessageFormat.carousel:
        return this._carouselFormat(envelope.message, options);
      case OutgoingMessageFormat.list:
        return this._listFormat(envelope.message, options);
      case OutgoingMessageFormat.quickReplies:
        return this._quickRepliesFormat(envelope.message, options);
      case OutgoingMessageFormat.text:
        return this._textFormat(envelope.message, options);

      default:
        throw new Error('Unknown message format');
    }
  }
}
