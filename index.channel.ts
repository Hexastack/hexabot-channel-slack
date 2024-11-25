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
import { NextFunction, Request, Response } from 'express';
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

  private homeTabContent: Slack.KnownBlock[];

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
    super(SLACK_CHANNEL_NAME, settingService, channelService, logger);
  }

  getPath(): string {
    return __dirname;
  }

  /**
   * Logs a debug message indicating the initialization of the Slack Channel Handler
   */
  async init(): Promise<void> {
    this.logger.setContext('Slack Channel Handler');
    this.logger.debug('Initializing...');
    const settings = await this.getSettings();
    this.homeTabContent = this.parseHomeTabContent(settings?.home_tab_content);
    this.api = new SlackApi(settings?.access_token, settings?.signing_secret);
  }

  isAppHomeOpenedEvent(event: Slack.Event): event is Slack.AppHomeOpened {
    return event.type === Slack.SlackType.app_home_opened;
  }

  /**
   * Processes the incoming request from Slack
   *
   * @param req - The HTTP request object
   * @param res - The HTTP response object
   * @returns
   */
  handle(req: Request, res: Response) {
    //debugger;
    this.logger.debug('Handling request...');
    const data = req.body as Slack.BodyEvent;

    // Handle url_verification for Slack API, return the challenge value
    if (this.isUrlVerificationEvent(data)) {
      this.logger.debug('Handling url_verification...');
      return res.status(200).send(data.challenge);
    }

    try {
      const event = new SlackEventWrapper(this, data);
      event.set('mid', this._generateId());

      if (event.shouldBeIgnored()) {
        this.logger.debug('Ignoring event:', event);
        return res.status(200).send('');
      }

      // If the event is an App Home Opened event, handle it
      if (this.isAppHomeOpenedEvent(event._raw)) {
        this.handleAppHomeOpened(event._raw); //TODO: add get started
        return res.status(200).send('');
      }

      // If the event is a response to a quick reply, edit the source message
      if (event.isQuickReplies()) {
        this.editQuickRepliesSourceMessage(event);
      }

      const type = event.getEventType();
      if (type) {
        this.eventEmitter.emit(`hook:chatbot:${type}`, event);
      } else {
        this.logger.error('Webhook received unknown event', event);
      }
    } catch (error) {
      this.logger.error('Something went wrong while handling events', error);
    }
    return res.status(200).send('');
  }

  isUrlVerificationEvent(
    data: Slack.BodyEvent,
  ): data is Slack.URLVerificationEvent {
    return 'type' in data && data.type === Slack.EventType.url_verification;
  }

  /**
   * Generates a unique ID for the Slack Channel Handler
   * 
   * @returns {string} - A unique ID
   
  */
  private _generateId(): string {
    return 'slack-' + uuidv4();
  }

  /**
   * Formats a text message that will be sent to Slack
   *
   * @param message - A text to be sent to the end user
   * @param options - might contain additional settings
   * @returns - A formatted text message understandable by Slack
   */
  _textFormat(
    message: StdOutgoingTextMessage,
    options?: BlockOptions,
  ): Slack.OutgoingMessage {
    return {
      text: message.text,
    };
  }

  /**
   * Format a text + quick replies message that can be sent to Slack
   *
   * @param message - A text + quick replies to be sent to the end user
   * @param options - might contain additional settings
   * @returns -A formatted quick replies message understandable by Slack
   */
  _quickRepliesFormat(
    message: StdOutgoingQuickRepliesMessage,
    options?: BlockOptions,
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

  /**
   * From raw buttons, construct a slack understandable message containing those buttons
   *
   * @param message - A text + buttons to be sent to the end user
   * @param options - Might contain additional settings
   * @returns - A formatted buttons message understandable by Slack
   */
  _buttonsFormat(
    message: StdOutgoingButtonsMessage,
    options?: BlockOptions,
    ...args: any
  ): Slack.OutgoingMessage {
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

  //This method will return undefined if the quick replies are not present

  /**
   * Uploads the attachment file to Slack and formats the quick replies if present
   *
   * @param message - An attachement + quick replies to be sent to the end user
   * @param channel - The slack channels to send the message to, separated by commas
   * @param options - Might contain additional settings
   * @returns
   */
  async _attachmentFormat(
    message: StdOutgoingAttachmentMessage<WithUrl<Attachment>>,
    channel: string,
    options?: BlockOptions,
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

  /**
   * Formats a collection of elements to be sent to Slack in carousel/list format
   *
   * @param data - A list of data items to be sent to the end user
   * @param options - Might contain additional settings
   * @returns - A Blocks array of Slack elements
   */
  _formatElements(data: any[], options: BlockOptions, ...args: any): any[] {
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

  /**
   * Formats a list message that can be sent to Slack
   *
   * @param message - Contains elements to be sent to the end user
   * @param options - Might contain additional settings
   * @returns - A ready to be sent list template message in the format required by Slack
   */
  _listFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
    ...args: any
  ): Slack.OutgoingMessage {
    const data = message.elements || [];
    const pagination = message.pagination;
    let buttons: Slack.ActionsBlock = {
        type: 'actions',
        elements: [],
      },
      elements: Array<Slack.KnownBlock> = [];

    // Items count min check
    if (data.length < 0) {
      this.logger.error('Unsufficient content count (must be >= 1 for list)');
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

  /**
   * Formats a carousel message that can be sent to Slack
   *
   *    NOTE: Carousel is not supported by Slack
   *
   *    This method will return a list message instead
   *
   * @param message - Contains elements to be sent to the end user
   * @param options - Might contain additional settings
   * @returns - A carousel ready to be sent in the format required by Slack
   */
  _carouselFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
    ...args: any
  ): Slack.OutgoingMessage {
    return this._listFormat(message, options);
  }

  /**
   * Formats a message to be sent to Slack
   *
   * @param envelope - The message to be sent {format, message}
   * @param channel - The slack channel to send the message to
   * @param options - Might contain additional settings
   * @returns - The formatted message in the format required by Slack
   */
  async _formatMessage(
    envelope: StdOutgoingEnvelope,
    channel: string,
    options: BlockOptions,
  ): Promise<Slack.OutgoingMessage> {
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

  /**
   * Sends a Slack message to the end user
   *
   * @param event - Incoming event/message being responded to
   * @param envelope - The message to be sent {format, message}
   * @param options - Might contain additional settings
   * @param context - Contextual data
   * @returns - The message ID if sent successfully, otherwise an error
   */

  async sendMessage(
    event: EventWrapper<any, any>,
    envelope: StdOutgoingEnvelope,
    options: BlockOptions,
    context: any,
  ): Promise<{ mid: string }> {
    const channel = (event._profile.channel as any)[SLACK_CHANNEL_NAME]
      .channel_id; //TODO: remove the any
    const message = await this._formatMessage(envelope, channel, options);

    if (message) {
      await this.api.sendMessage(message, channel);
    }

    return { mid: this._generateId() };
  }

  /**
   * Edits the source message of the quick replies
   * This method is called when the user selects a quick reply
   * and the source message needs to be updated to reflect the user's choice
   *
   * @param event - The event to wrap
   */
  editQuickRepliesSourceMessage(event: SlackEventWrapper) {
    const text =
      event._raw.original_message.attachments[0].text +
      '\n\n_You chose: ' +
      '*' +
      event._raw.actions[0].name +
      '*_';
    this.api.sendResponse({ attachments: [{ text }] }, event.getResponseUrl()); // assuming that quickreply message is only one attachment
  }

  //TODO: uploadAttachment

  /**
   * Fetches the end user profile data
   *
   * @param event - The event to wrap
   * @returns A Promise that resolves to the end user's profile data
   */
  async getUserData(
    event: EventWrapper<any, any>,
  ): Promise<SubscriberCreateDto> {
    const user = await this.api.getUserInfo(event.getSenderForeignId());

    const defautLanguage = await this.languageService.getDefaultLanguage();

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

  /**
   * Uploads the end user's profile picture to the attachment service
   *
   * @param user - The end user's profile data
   */
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
        this.logger.error('Error downloading profile picture', err);
      });
  }

  /**
   * Handles the App Home Opened event
   *
   * @param _raw - The raw event object
   */
  handleAppHomeOpened(_raw: Slack.AppHomeOpened) {
    if (_raw.tab === 'home') {
      this._setHomeTab(_raw.user);
    }
  }

  /**
   * Sets the home tab for the user
   * This method is called when the user opens the app home tab
   *
   * @param userId - The user ID
   */
  async _setHomeTab(userId: string) {
    const menuTree = await this.menuService.getTree();
    debugger;

    const res = await this.api.publishHomeTab(
      this.formatHomeTab(menuTree),
      userId,
    );
    if (!res.data.ok) {
      const errors = res.data.response_metadata.messages;
      await this.api.publishHomeTab(
        this.formatHomeTab(menuTree, this.buildInvalidContentBlocks(errors)),
        userId,
      );
    }
  }

  /**
   * Formats the home tab to be sent to Slack
   *
   * @param menuTree - The menu tree to be formatted
   * @returns - The formatted menu in the format required by Slack
   */
  formatHomeTab(
    menuTree: MenuTree,
    homeTabContent: Slack.KnownBlock[] = this.homeTabContent,
  ): Slack.HomeTabView {
    return {
      type: 'home',
      blocks: [
        ...homeTabContent,
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Menu:',
            emoji: true,
          },
        },
        {
          type: 'divider',
        },
        ...this.formatMenuBlocks(menuTree),
        {
          type: 'divider',
        },
      ],
      callback_id: 'Persistent_menu',
    };
  }

  /**
   * Builds content of the Home tab when the provided content is invalid
   * takes an array of errors and returns a formatted block
   *
   * @param errors
   * @returns
   */
  buildInvalidContentBlocks(errors: string[]): Slack.KnownBlock[] {
    {
      const errorMessages = errors?.join('\n');
      const errorsBlock: Slack.KnownBlock[] = errorMessages
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Errors:*',
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `\`\`\`${errorMessages}\`\`\``,
              },
            },
          ]
        : [];

      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':red_circle: *The provided content is invalid!*',
          },
        },
        { type: 'divider' },
        ...errorsBlock,
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'To fix this, ensure that you add the array of blocks in the `Slack` section of the Hexabot dashboard settings.',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'To help you create valid Slack block content, use the Block Kit Builder: <https://app.slack.com/block-kit-builder|Block Kit Builder>',
          },
        },
      ];
    }
  }

  /**
   * Formats the menu tree to be sent to Slack in the home tab
   *
   * @param menuTree
   * @param level
   * @returns
   */
  formatMenuBlocks(menuTree: MenuTree, level: number = 0): Slack.KnownBlock[] {
    const levelTab = '│       ';
    const blocks = menuTree.reduce((acc, item, index) => {
      const text =
        levelTab.repeat(Math.max(0, level - 1)) +
        (level > 0
          ? index === menuTree.length - 1
            ? '└──  '
            : '├──  '
          : ' ') +
        item.title;
      //'├' '── ' + item.title;
      //const text = '> ' + '─────────'.repeat(level) + ' *' + item.title + '*';
      if (item.type === MenuType.postback) {
        acc.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text,
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
            text,
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

              text,
            },
          },

          ...this.formatMenuBlocks(item.call_to_actions, level + 1),
        );
      }
      return acc;
    }, []);
    return blocks;
  }

  /**
   * Parses the content of the home tab.
   *
   * @param content - The content of the home tab
   * @returns
   */

  parseHomeTabContent(content: string): Slack.KnownBlock[] {
    try {
      const parsedContent = JSON.parse(content);
      if (Array.isArray(parsedContent)) {
        return parsedContent as any as Slack.KnownBlock[]; //TODO: check if it's correct
      }
    } catch (e) {}
    this.logger.warn('Invalid home tab content, using default content.');
    return this.buildInvalidContentBlocks(['Invalid JSON array']);
  }

  /**
   * Updates the access token for the Slack API
   *
   * @param setting
   */
  @OnEvent('hook:slack_channel:access_token')
  async updateAccessToken(setting: THydratedDocument<Setting>) {
    this.api.setAccessToken(setting.value);
  }

  /**
   * Updates the signing secret for the Slack API
   *
   * @param setting
   */
  @OnEvent('hook:slack_channel:signing_secret')
  async updateSigningSecret(setting: THydratedDocument<Setting>) {
    this.api.setSigningSecret(setting.value);
  }

  /**
   * Updates the content of the home tab
   *
   * @param setting
   */
  @OnEvent('hook:slack_channel:home_tab_content')
  updateHomeTabContent(setting: THydratedDocument<Setting>) {
    debugger;
    this.homeTabContent = this.parseHomeTabContent(setting.value);
  }

  /**
   * Middleware to verify the signature of an incoming request from Slack
   *
   * @param req
   * @param res
   * @param next
   * @returns
   */
  async middleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any> {
    if (!this.api.verifySignature(req)) {
      return res.status(401).send('Unauthorized');
    }
    next();
  }
}
