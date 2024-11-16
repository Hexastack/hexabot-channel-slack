/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Request, Response } from 'express';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { AttachmentService } from '@/attachment/services/attachment.service';
import { ChannelService } from '@/channel/channel.service';
import EventWrapper from '@/channel/lib/EventWrapper';
import ChannelHandler from '@/channel/lib/Handler';
import { ChannelName } from '@/channel/types';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { WithUrl } from '@/chat/schemas/types/attachment';
import { ButtonType } from '@/chat/schemas/types/button';
import {
  OutgoingMessageFormat,
  StdOutgoingAttachmentMessage,
  StdOutgoingButtonsMessage,
  StdOutgoingEnvelope,
  StdOutgoingListMessage,
  StdOutgoingQuickRepliesMessage,
  StdOutgoingTextMessage,
} from '@/chat/schemas/types/message';
import { BlockOptions } from '@/chat/schemas/types/options';
import { MenuTree, MenuType } from '@/cms/schemas/types/menu';
import { MenuService } from '@/cms/services/menu.service';
import { LanguageService } from '@/i18n/services/language.service';
import { LoggerService } from '@/logger/logger.service';
import { Setting } from '@/setting/schemas/setting.schema';
import { SettingService } from '@/setting/services/setting.service';
import { THydratedDocument } from '@/utils/types/filter.types';

import { SLACK_CHANNEL_NAME } from './settings';
import { SlackApi } from './slack-api';
import { Slack } from './types';
import SlackFileUploader from './uploader';
import SlackEventWrapper from './wrapper';

@Injectable()
export class SlackHandler extends ChannelHandler<typeof SLACK_CHANNEL_NAME> {
  private api: SlackApi;

  constructor(
    settingService: SettingService,
    channelService: ChannelService,
    logger: LoggerService,
    protected readonly eventEmitter: EventEmitter2,
    protected readonly httpService: HttpService,
    protected readonly settingsService: SettingService,
    protected readonly attachmentService: AttachmentService,
    protected readonly menuService: MenuService,
    protected readonly languageService: LanguageService,
  ) {
    super('slack-channel', settingService, channelService, logger);
  }

  getPath(): string {
    return __dirname;
  }

  /**
   * Logs a debug message indicating the initialization of the Slack Channel Handler
   */
  async init(): Promise<void> {
    this.logger.debug('Slack Channel Handler: Initializing...');
    const settings = await this.getSettings();
    this.api = new SlackApi(settings.access_token, settings.signing_secret);
  }

  handle(req: Request, res: Response) {
    this.logger.debug('Slack Channel Handler: Handling request...');
    const data = req.body;

    if (data.type && data.type === 'url_verification') {
      this.logger.debug('Slack Channel Handler: Handling url_verification...');
      return res.status(200).send(data.challenge);
    }

    if (!this.api.verifySignature(req)) return; // TODO: maybe handle this in a middleware

    try {
      const event = new SlackEventWrapper(this, data);
      event.set('mid', this._generateId());
      debugger;
      if (event.isQuickReplies()) {
        this.editQuickRepliesSourceMessage(event);
      }
      if (event._raw.type === Slack.SlackType.app_home_opened) {
        this.handleAppHomeOpened(event._raw as Slack.AppHomeOpened);
        return res.status(200).send('');
      }

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
    return res.status(200).send('');
  }

  handleAppHomeOpened(_raw: Slack.AppHomeOpened) {
    if (_raw.tab === 'home') {
      this._setHomeTab();
    }
  }

  //TODO: duplicate method
  private _generateId(): string {
    return 'slack-' + uuidv4();
  }

  _textFormat(
    message: StdOutgoingTextMessage,
    options?: any,
  ): Slack.OutgoingMessage {
    return {
      text: message.text,
    };
  }

  _quickRepliesFormat(
    message: StdOutgoingQuickRepliesMessage,
    options?: any,
  ): Slack.OutgoingMessage {
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
          callback_id: Slack.CallbackId.quick_replies,
        },
      ],
    };
  }

  _buttonsFormat(
    message: StdOutgoingButtonsMessage,
    options?: any,
    ...args: any
  ): Slack.OutgoingMessage {
    //debugger;
    const textSection: Slack.SectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message.text,
      },
    };
    const elements: Slack.Button[] = message.buttons.map((btn) => {
      // TODO: handle non compact urls with link unfurling: https://api.slack.com/reference/messaging/link-unfurling#event_deliveries
      if (btn.type === ButtonType.web_url) {
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: btn.title,
            emoji: true,
          },
          value: 'url',
          url: btn.url,
        };
      } else {
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: btn.title,
            emoji: true,
          },
          value: btn.payload,
        };
      }
    });
    return {
      blocks: [textSection, { type: 'actions', elements }],
    };
  }

  //TODO: get usersList

  async _attachmentFormat(
    message: StdOutgoingAttachmentMessage<WithUrl<Attachment>>,
    channel: string,
    options?: any,
  ): Promise<Slack.OutgoingMessage> {
    const fileUploader = new SlackFileUploader(
      this.api,
      message.attachment,
      channel,
      this.attachmentService,
    );
    await fileUploader.upload();

    if (message.quickReplies?.length > 0)
      return this._quickRepliesFormat({
        text: '',
        quickReplies: message.quickReplies,
      });
    return undefined;
  }

  _formatElements(data: any[], options: any, ...args: any): any[] {
    const fields = options.content.fields;
    const buttons = options.content.buttons;
    //To build a list :
    const blocks: Slack.KnownBlock[] = [{ type: 'divider' }];
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
      buttons.forEach((button, index) => {
        const btn = { ...button };
        // Set custom title for first button if provided
        if (index === 0 && fields.action_title && item[fields.action_title]) {
          btn.title = item[fields.action_title];
        }
        if (button.type === 'web_url') {
          // Get built-in or an exter nal URL from custom field
          const urlField = fields.url;
          btn.url = urlField && item[urlField] ? item[urlField] : '';
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
          debugger;
          btn.payload = btn.title + ':' + 'payload //TODO: to remove'; //item.getPayload();
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

  _listFormat(
    message: StdOutgoingListMessage,
    options: any,
    ...args: any
  ): Slack.OutgoingMessage {
    debugger;
    const data = message.elements || [];
    const pagination = message.pagination;
    let buttons: Slack.ActionsBlock = {
        type: 'actions',
        elements: [],
      },
      elements: Array<Slack.KnownBlock> = [];

    // Items count min check
    if (data.length < 0) {
      this.logger.error(
        'Slack Channel Handler : Unsufficient content count (must be >= 1 for list)',
      );
      throw new Error('Unsufficient content count (list >= 1)');
    }
    elements = this._formatElements(data, options);
    //Adding the block of VIEW_MORE:
    if (pagination.total - pagination.skip - pagination.limit > 0) {
      buttons = {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View More',
              emoji: true,
            },
            value: 'VIEW_MORE',
          },
        ],
      };
      elements.push(buttons);
    }

    return { blocks: elements };
  }

  _carouselFormat(
    message: StdOutgoingListMessage,
    options: any,
    ...args: any
  ): Slack.OutgoingMessage {
    return this._listFormat(message, options);
  }

  async sendMessage(
    event: EventWrapper<any, any>,
    envelope: StdOutgoingEnvelope,
    options: BlockOptions,
    context: any,
  ): Promise<{ mid: string }> {
    debugger;
    const channel = (event._profile.channel as any).channel_id; //TODO: remove the any
    const message = await this._formatMessage(envelope, channel, options);

    if (message) {
      await this.api.sendMessage(message, channel);
    }

    return { mid: this._generateId() };
  }

  editQuickRepliesSourceMessage(event: SlackEventWrapper) {
    const text =
      event._raw.original_message.attachments[0].text +
      '\n\n_You chose: ' +
      '*' +
      event._raw.actions[0].name +
      '*_';
    this.api.sendResponse({ attachments: [{ text }] }, event.getResponseUrl()); // assuming that quickreply message is only one attachment
  }

  async getUserData(
    event: EventWrapper<any, any>,
  ): Promise<SubscriberCreateDto> {
    const user = await this.api.getUserInfo(event.getSenderForeignId());

    const defautLanguage = await this.languageService.getDefaultLanguage();
    debugger;
    this.uploadProfilePicture(user);
    const profile = user.profile;

    return {
      foreign_id: user.id,
      first_name:
        profile.first_name || profile.display_name || profile.real_name,
      last_name: profile.last_name || profile.display_name || profile.real_name,
      timezone: Math.floor(user.tz_offset / 3600), //not sure
      gender: 'Unknown',
      channel: {
        name: this.getName() as ChannelName,
      },
      assignedAt: null,
      assignedTo: null,
      labels: [],
      locale: 'en', //TODO: to check
      language: defautLanguage.code,
      country: '',
      lastvisit: new Date(),
      retainedFrom: new Date(),
    };
  }

  uploadProfilePicture(user: Slack.User) {
    //get the image_* with the highest resolution
    const imageAttribute = Object.keys(user.profile)
      .filter((key) => key.startsWith('image_'))
      .map((key) => parseInt(key.split('_')[1]))
      .filter((key) => !isNaN(key))
      .reduce((acc, curr) => (acc > curr ? acc : curr), 0);
    const imageUrl = user.profile['image_' + imageAttribute];

    if (!imageUrl) return;
    fetch(imageUrl, {})
      .then((res) => {
        this.attachmentService.uploadProfilePic(res, user.id + '.jpeg');
      })
      .catch((err) => {
        this.logger.error(
          'Slack Channel Handler Error downloading profile picture',
          err,
        );
      });
  }

  async _formatMessage(
    envelope: StdOutgoingEnvelope,
    channel: string,
    options: BlockOptions,
  ): Promise<Slack.OutgoingMessage> {
    ////debugger;
    //TODO: Why is this method not in ChannelHandler?
    //TODO: update return type
    switch (envelope.format) {
      case OutgoingMessageFormat.attachment:
        return await this._attachmentFormat(envelope.message, channel, options);
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

  async _setHomeTab() {
    const menuTree = await this.menuService.getTree();
    const tempUserId = 'U07PKPB6W2Y'; //TODO: to remove
    this.api.publishHomeTab(this.formatMenu(menuTree), tempUserId);
  }

  formatMenu(menuTree: MenuTree): Slack.HomeTabView {
    return {
      type: 'home',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Hexabot',
            emoji: true,
          },
        },

        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Welcome to *Hexabot!*\n',
          },
        },
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Menu:',
            emoji: true,
          },
        },

        ...this.formatMenuBlocks(menuTree),
      ],
      callback_id: 'Persistent_menu',
    };
  }

  formatMenuBlocks(menuTree: MenuTree, level: number = 0): Slack.KnownBlock[] {
    debugger;

    const blocks = menuTree.reduce((acc, item) => {
      acc.push({
        type: 'divider',
      });
      if (item.type === MenuType.postback) {
        acc.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '> ' +
              '                   '.repeat(level) +
              '*' +
              item.title +
              '*',
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Select',
            },
            value: item.payload,
          },
        });
      }
      if (item.type === MenuType.web_url) {
        acc.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '> ' +
              '                   '.repeat(level) +
              '*' +
              item.title +
              '*',
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Visit',
            },

            url: item.url,
          },
        });
      }
      if (item.type === MenuType.nested) {
        // call the function recursively
        acc.push(
          /*{
            type: 'divider',
          },*/
          {
            type: 'section',
            text: {
              type: 'mrkdwn',

              text:
                '> ' +
                '                   '.repeat(level) +
                '*' +
                item.title +
                ':*',
            },
          },
          {
            type: 'divider',
          },
          ...this.formatMenuBlocks(item.call_to_actions, level + 1),
          {
            type: 'divider',
          },
        );
      }
      return acc;
    }, []);
    return blocks;
  }

  @OnEvent('hook:slack_channel:access_token') //Make the settings event more specific to slack channel
  async updateAccessToken(setting: THydratedDocument<Setting>) {
    this.api.setAccessToken(setting.value);
  }

  @OnEvent('hook:slack_channel:signing_secret')
  async updateSigningSecret(setting: THydratedDocument<Setting>) {
    this.api.setSigningSecret(setting.value);
  }
}
