/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { createHmac } from 'crypto';
import { Stream } from 'stream';

import { HttpService } from '@nestjs/axios';
import { Injectable, RawBodyRequest } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import * as SlackTypes from '@slack/types';
import { WebClient } from '@slack/web-api';
import { File } from '@slack/web-api/dist/types/response/ChannelsHistoryResponse';
import { NextFunction, Request, Response } from 'express';
import tsscmp from 'tsscmp';
import { v4 as uuidv4 } from 'uuid';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { AttachmentService } from '@/attachment/services/attachment.service';
import { AttachmentAccess, AttachmentFile } from '@/attachment/types';
import { ChannelService } from '@/channel/channel.service';
import ChannelHandler from '@/channel/lib/Handler';
import { SubscriberCreateDto } from '@/chat/dto/subscriber.dto';
import { AttachmentRef } from '@/chat/schemas/types/attachment';
import { ButtonType } from '@/chat/schemas/types/button';
import {
  IncomingMessageType,
  OutgoingMessageFormat,
  StdEventType,
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
import { SecretSetting, TextareaSetting } from '@/setting/schemas/types';
import { SettingService } from '@/setting/services/setting.service';
import { THydratedDocument } from '@/utils/types/filter.types';

import { SLACK_CHANNEL_NAME } from './settings';
import { Slack } from './types';
import SlackEventWrapper from './wrapper';

const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
];

@Injectable()
export class SlackHandler extends ChannelHandler<typeof SLACK_CHANNEL_NAME> {
  private api: WebClient;

  private homeTabContent: SlackTypes.KnownBlock[];

  constructor(
    settingService: SettingService,
    channelService: ChannelService,
    logger: LoggerService,
    protected readonly eventEmitter: EventEmitter2,
    protected readonly httpService: HttpService,
    protected readonly settingsService: SettingService,
    public readonly attachmentService: AttachmentService,
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
    this.logger.debug('Initializing...');
    const settings = await this.getSettings();
    this.UploadAllStoredAttachements();
    this.homeTabContent = this.parseHomeTabContent(settings?.home_tab_content);
    this.api = new WebClient(settings?.access_token);
  }

  /**
   * Determines whether a given Slack event is of type `app_home_opened`.
   * @param e - The Slack event to check.
   * @returns - Returns `true` if the event is of type `app_home_opened`, otherwise `false`.
   */
  isAppHomeOpenedEvent(
    e: Slack.EventCallback<SlackTypes.SlackEvent>,
  ): e is Slack.EventCallback<SlackTypes.AppHomeOpenedEvent> {
    return e.event.type === 'app_home_opened';
  }

  /**
   * Determines if a Slack message event should be ignored or not.
   *
   * @returns - Returns `true` if the event is supported
   */
  isSupportedEvent(
    e: Slack.EventCallback<SlackTypes.SlackEvent>,
  ): e is Slack.EventCallback<Slack.SupportedEvent> {
    return (
      ['message', 'app_mention'].includes(e.event.type) &&
      e.type === 'event_callback'
    );
  }

  isEvent(
    data:
      | Slack.BlockAction<Slack.ButtonAction>
      | Slack.EventCallback<SlackTypes.SlackEvent>,
  ): data is Slack.EventCallback<SlackTypes.SlackEvent> {
    return 'event' in data;
  }

  /**
   * Seperate files and text messages in the incoming Slack request payload
   *
   * @param req - The HTTP request object
   * @param res - The HTTP response object
   * @returns An array of payloads
   */
  separateTextAndAttachments(data: Slack.IncomingEvent): Slack.IncomingEvent[] {
    if (this.isEvent(data)) {
      const { event } = data;
      // Check if both `text` and `files` exist
      if ('text' in event && 'files' in event) {
        const { text, files, ...restEvent } =
          event as SlackTypes.GenericMessageEvent;

        // Create two payloads: one with text, another with files
        const textPayload: Slack.EventCallback<SlackTypes.GenericMessageEvent> =
          {
            ...data,
            event: {
              ...restEvent,
              text,
              files: undefined, // Exclude files in this part
            },
          };

        const filesPayload: Slack.EventCallback<SlackTypes.GenericMessageEvent> =
          {
            ...data,
            event: {
              ...restEvent,
              text: undefined, // Exclude text in this part
              files,
            },
          };

        return [textPayload, filesPayload];
      }
    }

    // If no split is required, return the original payload as a single-item array
    return [data];
  }

  /**
   * Processes the incoming request from Slack
   *
   * @param req - The HTTP request object
   * @param res - The HTTP response object
   */
  async handle(req: Request, res: Response) {
    this.logger.debug('Handling request...');

    // Handle url_verification for Slack API, return the challenge value
    if (this.isUrlVerificationEvent(req.body)) {
      this.logger.debug('Handling url_verification...');
      return res.status(200).send(req.body.challenge);
    }

    const data =
      'payload' in req.body
        ? (JSON.parse(
            req.body.payload,
          ) as Slack.BlockAction<Slack.ButtonAction>)
        : this.isEvent(req.body)
          ? req.body
          : undefined;

    if (!data) {
      this.logger.debug('Unknown event!');
      return res.status(400).send('');
    }

    if (this.isEvent(data)) {
      if (this.isAppHomeOpenedEvent(data)) {
        // If the event is an App Home Opened event, handle it
        this.handleAppHomeOpened(data);
        return res.status(200).send('');
      } else if (!this.isSupportedEvent(data)) {
        // If the event is currently not supported
        this.logger.debug('Ignoring event:', data);
        return res.status(200).send('');
      }
    } else if (data.actions[0]?.value === 'url') {
      // Ignore buttons URL postbacks
      this.logger.debug('Ignoring url postbacks:', data);
      return res.status(200).send('');
    }

    const events = this.separateTextAndAttachments(data);

    events.forEach((e) => {
      try {
        const event = new SlackEventWrapper(this, e);
        const type = event.getEventType();

        if (type !== StdEventType.unknown) {
          this.eventEmitter.emit(`hook:chatbot:${type}`, event);
        } else {
          this.logger.error('Webhook received unknown event', event);
        }
      } catch (error) {
        this.logger.error('Something went wrong while handling events', error);
      }
    });

    return res.status(200).send('');
  }

  /**
   * Checks if a Slack event is a URL verification event.
   *
   * @param data - The event data to check.
   * @returns - Returns `true` if the event is of type `url_verification`, otherwise `false`.
   */
  isUrlVerificationEvent(data: any): data is Slack.URLVerificationEvent {
    return 'type' in data && data.type === 'url_verification';
  }

  /**
   * Generates a unique ID for the Slack Channel Handler
   *
   * @returns - A unique ID
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
    _options?: BlockOptions,
  ): Slack.OutgoingMessage {
    const text = message.text.replaceAll('**', '*');
    return {
      text,
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
    _options?: BlockOptions,
  ): Slack.Blocks {
    const textSection: SlackTypes.KnownBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message.text,
      },
    };
    const elements: SlackTypes.ActionsBlockElement[] = message.quickReplies.map(
      (qr) => {
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: qr.title,
            emoji: true,
          },
          value: qr.payload,
        };
      },
    );

    return {
      text: message.text === '' ? 'quick Replies' : message.text,
      blocks:
        message.text === ''
          ? [{ type: 'actions', elements }]
          : [textSection, { type: 'actions', elements }],
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
    _options?: BlockOptions,
    ..._args: any
  ): Slack.OutgoingMessage {
    const textSection: SlackTypes.SectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message.text,
      },
    };
    const elements: SlackTypes.ActionsBlockElement[] = message.buttons.map(
      (btn) => {
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
      },
    );
    return {
      blocks: [textSection, { type: 'actions', elements }],
    };
  }

  /**
   * Uploads the attachment file to Slack and formats the quick replies if present
   *
   * @param message - An attachment + quick replies to be sent to the end user
   * @param channel - The slack channels to send the message to, separated by commas
   * @param options - Might contain additional settings
   * @returns
   */
  async _attachmentFormat(
    message: StdOutgoingAttachmentMessage,
    _options?: BlockOptions,
  ): Promise<Slack.OutgoingMessage | undefined> {
    const attachmentRef = message.attachment.payload;
    if ('id' in attachmentRef && attachmentRef.id) {
      let attachment = await this.attachmentService.findOne(attachmentRef.id);

      if (!attachment) {
        throw new Error(`Unable to find attachment ${attachmentRef.id}`);
      }
      attachment = await this.uploadImageIfNotExists(attachment);
      if (this.attachmentIsSlackImage(attachment)) {
        return {
          text: 'image',
          blocks: [
            {
              type: 'image',
              title: {
                type: 'plain_text',
                text: attachment.name,
              },
              block_id:
                'image_block_' +
                attachment.channel?.[this.getName()].slackFile.id,
              slack_file: {
                id: attachment.channel?.[this.getName()].slackFile.id,
              },
              alt_text: attachment.name,
            },
            ...(message.quickReplies?.length
              ? this._quickRepliesFormat({
                  text: '',
                  quickReplies: message.quickReplies || [],
                }).blocks
              : []),
          ],
        };
      }
    }
    return message.quickReplies?.length
      ? this._quickRepliesFormat({
          text: '',
          quickReplies: message.quickReplies || [],
        })
      : undefined;
  }

  async addRemoteFile(attachment: Attachment) {
    return this.api.files.remote.add({
      external_id: attachment.id,
      title: attachment.name,
      external_url: await this.getPublicUrl(attachment),
    });
  }

  /**
   * Formats a collection of elements to be sent to Slack in carousel/list format
   *
   * @param data - A list of data items to be sent to the end user
   * @param options - Might contain additional settings
   * @returns - A Blocks array of Slack elements
   */
  async _formatElements(
    data: any[],
    options: BlockOptions,
  ): Promise<SlackTypes.KnownBlock[]> {
    const fields = options.content?.fields;
    const buttons = options.content?.buttons || [];
    //To build a list :
    const blocks: SlackTypes.KnownBlock[] = [{ type: 'divider' }];
    for (const item of data) {
      const text =
        fields?.subtitle && item[fields.subtitle]
          ? '*' + item[fields.title] + '*\n' + item[fields.subtitle]
          : '*' + item.title + '*';
      //Block containing the title and subtitle and image
      const main_block: SlackTypes.SectionBlock = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      };

      if (fields?.image_url && item[fields.image_url]) {
        const url =
          typeof item[fields.image_url] === 'string'
            ? item[fields.image_url]
            : await this.getPublicUrl(item[fields.image_url].payload);
        main_block.accessory = {
          type: 'image',
          image_url: url,
          alt_text: item[fields.title],
        };
      }
      blocks.push(main_block);
      //Array of elements : Buttons
      const elements: SlackTypes.ActionsBlockElement[] = [];
      buttons.forEach((button, index) => {
        const btn = { ...button };
        // Set custom title for first button if provided
        if (index === 0 && fields?.action_title && item[fields.action_title]) {
          btn.title = item[fields.action_title];
        }
        if (btn.type === ButtonType.web_url) {
          // Get built-in or an exter nal URL from custom field
          const urlField = fields?.url;
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
    }

    return blocks;
  }

  /**
   * Formats a list message that can be sent to Slack
   *
   * @param message - Contains elements to be sent to the end user
   * @param options - Might contain additional settings
   * @returns - A ready to be sent list template message in the format required by Slack
   */
  async _listFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
  ): Promise<Slack.OutgoingMessage> {
    const data = message.elements || [];
    const pagination = message.pagination;
    let buttons: SlackTypes.ActionsBlock = {
        type: 'actions',
        elements: [],
      },
      elements: Array<SlackTypes.KnownBlock> = [];

    // Items count min check
    if (data.length < 0) {
      this.logger.error('Unsufficient content count (must be >= 1 for list)');
      throw new Error('Unsufficient content count (list >= 1)');
    }
    elements = await this._formatElements(data, options);
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
  async _carouselFormat(
    message: StdOutgoingListMessage,
    options: BlockOptions,
    ..._args: any
  ): Promise<Slack.OutgoingMessage> {
    return await this._listFormat(message, options);
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
    options: BlockOptions,
  ): Promise<Slack.OutgoingMessage | undefined> {
    switch (envelope.format) {
      case OutgoingMessageFormat.attachment:
        return await this._attachmentFormat(envelope.message, options);
      case OutgoingMessageFormat.buttons:
        return this._buttonsFormat(envelope.message, options);
      case OutgoingMessageFormat.carousel:
        return await this._carouselFormat(envelope.message, options);
      case OutgoingMessageFormat.list:
        return await this._listFormat(envelope.message, options);
      case OutgoingMessageFormat.quickReplies:
        return this._quickRepliesFormat(envelope.message, options);
      case OutgoingMessageFormat.text:
        return this._textFormat(envelope.message, options);

      default:
        throw new Error('Unknown message format');
    }
  }

  /**
   * Uploads all stored attachments that have not been uploaded to Slack yet.
   *
   * This function retrieves all attachments from the database that do not have a Slack file ID associated with them.
   * It then uploads each attachment to Slack and saves the Slack file ID in the database to ensure that each attachment
   * is uploaded only once.
   *
   * @returns {Promise<void>} A promise that resolves when all attachments have been processed.
   */
  async UploadAllStoredAttachements() {
    //TODO: find a better name
    const attachments = await this.attachmentService.find({
      [`channel.${this.getName()}`]: { $exists: false },
    });
    attachments.forEach((attachment) => {
      this.uploadImageIfNotExists(attachment).catch((error) => {
        this.logger.error(
          `Failed to upload attachment ${attachment.id}`,
          error,
        );
      });
    });
  }

  /**
   * Checks if the attachment is supported by Slack image block.
   * Slack image blocks only support images.
   *
   * @param attachment - The attachment to check.
   * @returns - Returns `true` if the attachment is supported by Slack image block, otherwise `false`.
   */
  attachmentIsSlackImage(attachment: Attachment) {
    return SUPPORTED_IMAGE_TYPES.includes(attachment.type);
  }

  /**
   * Uploads a file to Slack.
   *
   * This method reads the file from the provided attachment and uploads it to the specified Slack channel.
   * If the file cannot be read, an error is thrown.
   *
   * @param attachment - The attachment to upload. This should be an object containing the file details.
   * @param channel_id - The ID of the Slack channel to upload the file to. This is optional.
   * @returns - A promise that resolves to the response from the Slack API.
   * @throws - Throws an error if the file cannot be read or if the upload fails.
   */
  async uploadFile(attachment: Attachment, channel_id?: string) {
    const file = await this.attachmentService.readAsStream(attachment);
    if (!file) {
      const attachmentId = attachment.id || attachment['_id']?.toString();
      throw new Error(`Unable to read attachment ${attachmentId} file`);
    }

    return await this.api.filesUploadV2({
      filename: attachment?.name,
      file,
      channel_id,
    });
  }

  /**
   * Uploads a file to Slack if it is not already uploaded.
   *
   * This method reads the file from the provided attachment and uploads it to the specified Slack channel.
   * If the file cannot be read, an error is thrown.
   *
   * @param attachment - The attachment to upload. This should be an object containing the file details.
   * @param channel_id - The ID of the Slack channel to upload the file to. This is optional.
   * @returns - A promise that resolves to the response from the Slack API.
   * @throws - Throws an error if the file cannot be read or if the upload fails.
   */
  async uploadImageIfNotExists(attachment: Attachment): Promise<Attachment> {
    if (attachment.channel?.[this.getName()]) {
      return attachment;
    }

    const attachmentId = attachment.id || attachment['_id']?.toString();
    const uploadResponse = await this.uploadFile(attachment);

    const { id, url_private } = uploadResponse?.files?.[0]?.files?.[0] as File;
    if (!id) {
      throw new Error('Failed to upload image to Slack');
    }

    return this.attachmentService.updateOne(attachmentId, {
      channel: {
        ...(attachment.channel || {}),
        [this.getName()]: { slackFile: { id, url_private } },
      },
    });
  }

  /**
   * Handles the attachment and returns the possible quick replies with it and the message ID.
   *
   * This function supports two types of attachment references: by ID or by URL. Depending on the reference type,
   * the attachment is either fetched from the service or shared as a remote file to the Slack channel.
   *
   * If the attachment is an image, it will be formatted and sent as an image block. If the attachment is a file,
   * it will be shared in the specified Slack channel. Additionally, if there are quick replies associated
   * with the message, they will be formatted and included in the response.
   *
   * @param message - The message containing the attachment and optional quick replies to be sent to the end user.
   * @param channelId - The ID of the Slack channel to which the attachment will be sent.
   * @param _options - Optional settings that might contain additional configurations.
   *
   * @returns A promise that resolves to an object containing the formatted message and the message ID (mid).
   * If quick replies are present, they will be included in the formatted message.
   *
   * @throws Will throw an error if the attachment cannot be found or shared.
   */
  async handleAttachment(
    message: StdOutgoingAttachmentMessage,
    channelId: string,
    _options?: BlockOptions,
  ) {
    const attachmentRef = message.attachment.payload;
    if ('id' in attachmentRef && attachmentRef.id) {
      let attachment = await this.attachmentService.findOne(attachmentRef.id);

      if (!attachment) {
        throw new Error(`Unable to find attachment ${attachmentRef.id}`);
      }
      attachment = await this.uploadImageIfNotExists(attachment);
      if (this.attachmentIsSlackImage(attachment)) {
        return {
          message: {
            text: 'image',
            blocks: [
              {
                type: 'image',
                title: {
                  type: 'plain_text',
                  text: attachment.name,
                },
                block_id:
                  'image_block_' +
                  attachment.channel?.[this.getName()].slackFile.id,
                slack_file: {
                  id: attachment.channel?.[this.getName()].slackFile.id,
                },
                alt_text: attachment.name,
              },
              ...(message.quickReplies?.length
                ? this._quickRepliesFormat({
                    text: '',
                    quickReplies: message.quickReplies || [],
                  }).blocks
                : []),
            ],
          },
        };
      } else {
        const result = await this.api.files.remote.share({
          channels: channelId,
          file: attachment.channel?.[this.getName()].slackFile.id,
        });
        const mid = result.file?.shares?.private?.[channelId][0].ts; //get the ts of the last share of the file
        return message.quickReplies?.length
          ? {
              message: this._quickRepliesFormat({
                text: '',
                quickReplies: message.quickReplies || [],
              }),
              mid,
            }
          : { mid };
      }
    }

    if ('url' in attachmentRef && attachmentRef.url) {
      const addResult = await this.api.files.remote.add({
        title: this.getFilenameFromUrl(attachmentRef.url),
        external_id: attachmentRef.url,
        external_url: attachmentRef.url,
      });

      const slack_file_id = addResult.file?.id as string;
      const shareResult = await this.api.files.remote.share({
        file: slack_file_id,
        channels: channelId,
      });

      const mid = shareResult.file?.shares?.private?.[channelId][0].ts; //get the ts of the last share of the file
      return message.quickReplies?.length
        ? {
            message: this._quickRepliesFormat({
              text: '',
              quickReplies: message.quickReplies || [],
            }),
            mid,
          }
        : { mid };
    }
  }

  /**
   * Extracts the filename from a given URL.
   *
   * @param url - The URL from which to extract the filename.
   * @returns - The extracted filename as a string.
   */
  getFilenameFromUrl(url) {
    const path = new URL(url).pathname;
    const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path; // Remove trailing slash if exists
    const filename = cleanPath.substring(cleanPath.lastIndexOf('/') + 1); // Extract the filename
    return filename;
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
    event: SlackEventWrapper,
    envelope: StdOutgoingEnvelope,
    options: BlockOptions,
    _context: any,
  ): Promise<{ mid: string }> {
    const channelId = event.getSenderForeignId();
    let message;
    if (envelope.format === OutgoingMessageFormat.attachment) {
      message = await this.handleAttachment(
        envelope.message,
        channelId,
        options,
      );
    } else {
      message = await this._formatMessage(envelope, options);
    }

    if (message) {
      const data = await this.api.chat.postMessage({
        ...message,
        channel: channelId,
      });

      return { mid: data.message?.ts || this._generateId() };
    }

    return { mid: this._generateId() };
  }

  /**
   * Fetches the remote files by URL.
   *
   * @param event - The received message event
   * @returns - A promise resolving to the metadata of the attachment files.
   */
  async getMessageAttachments(
    event: SlackEventWrapper,
  ): Promise<AttachmentFile[]> {
    if (
      event._adapter.eventType === StdEventType.message &&
      event._adapter.messageType === IncomingMessageType.attachments
    ) {
      const settings = await this.getSettings();
      const remoteFiles = event._adapter.raw.event
        .files as Slack.UploadedFile[];

      const files: AttachmentFile[] = [];
      for (const remoteFile of remoteFiles) {
        const response = await this.httpService.axiosRef.get<Stream>(
          remoteFile.url_private_download,
          {
            responseType: 'stream', // Ensures the response is returned as a binary buffer
            headers: {
              Authorization: `Bearer ${settings.access_token}`,
            },
          },
        );

        files.push({
          file: response.data,
          size: remoteFile.size || parseInt(response.headers['content-length']),
          type: remoteFile.mimetype,
        });
      }

      return files;
    }

    return [];
  }

  @OnEvent('hook:attachment:postCreate')
  async uploadAttachmentOnCreate(attachment: THydratedDocument<Attachment>) {
    if (attachment.access === AttachmentAccess.Private) {
      return;
    }
    if (attachment.channel && this.getName() in attachment.channel) {
      this.logger.log('Slack channel Handler: Attachment already synced');
      return;
    }
    const result = await this.uploadImageIfNotExists(attachment.toObject());
    if (result) {
      this.logger.log(
        `Slack Channel Handler: Succesfully uploaded attchement ${attachment._id}`,
      );
    }
  }

  /**
   * Fetches the subscriber avatar from Slack
   *
   * @param event The message event
   * @returns The avatar file
   */
  async getSubscriberAvatar(
    event: SlackEventWrapper,
  ): Promise<AttachmentFile | undefined> {
    const profile = event.getProfile();

    // Save profile picture locally (messenger URL expires)
    if (profile) {
      // Get the image_* with the highest resolution
      const imageAttribute = Object.keys(profile)
        .filter((key) => key.startsWith('image_'))
        .map((key) => parseInt(key.split('_')[1]))
        .filter((key) => !isNaN(key))
        .reduce((acc, curr) => (acc > curr ? acc : curr), 0);
      const imageUrl = profile['image_' + imageAttribute];
      const response = await this.httpService.axiosRef.get<Stream>(imageUrl, {
        responseType: 'stream',
      });

      return {
        file: response.data,
        type: response.headers['content-type'],
        size: parseInt(response.headers['content-length']),
      };
    }

    return undefined;
  }

  /**
   * Fetches the end user profile data
   *
   * @param event - The event to wrap
   * @returns A Promise that resolves to the end user's profile data
   */
  async getSubscriberData(
    event: SlackEventWrapper,
  ): Promise<SubscriberCreateDto> {
    const { channelType: channelType } = event.getChannelData();
    const channelId = event.getSenderForeignId();
    const defautLanguage = await this.languageService.getDefaultLanguage();

    if (channelType === 'im') {
      const userId = event.getUserForeignId();
      const userInfo = await this.api.users.info({ user: userId });

      if (!userInfo.ok) {
        this.logger.error('Unable to retrieve user info', userInfo.error);
        throw new Error('Unable to retrieve user info');
      }

      const profile = userInfo.user?.profile;

      event.setProfile(profile);

      return {
        foreign_id: channelId,
        first_name:
          profile?.first_name ||
          profile?.display_name ||
          profile?.real_name ||
          'Anonymous',
        last_name:
          profile?.last_name ||
          profile?.display_name ||
          profile?.real_name ||
          'Anonymous',
        timezone: userInfo.user?.tz_offset,
        gender: profile?.pronouns,
        channel: event.getChannelData(),
        assignedAt: null,
        assignedTo: null,
        labels: [],
        locale: userInfo.user?.locale,
        language: defautLanguage.code,
        country: '',
        lastvisit: new Date(),
        retainedFrom: new Date(),
      };
    } else {
      const convInfo = await this.api.conversations.info({
        channel: event.getSenderForeignId(),
      });

      if (!convInfo.ok) {
        this.logger.error(
          'Unable to retrieve conversation info',
          convInfo.error,
        );
        throw new Error('Unable to retrieve conversation info');
      }

      const channel = convInfo.channel;

      return {
        foreign_id: channelId,
        first_name: '#',
        last_name: channel?.name || 'Unknown',
        gender: 'Unknown',
        timezone: 0,
        channel: event.getChannelData(),
        avatar: null,
        assignedAt: null,
        assignedTo: null,
        labels: [],
        locale: 'en',
        language: defautLanguage.code,
        country: '',
        lastvisit: new Date(),
        retainedFrom: new Date(),
      };
    }
  }

  /**
   * Handles the App Home Opened event
   *
   * @param e - The raw event object
   */
  handleAppHomeOpened(e: Slack.EventCallback<SlackTypes.AppHomeOpenedEvent>) {
    if (e.event.tab === 'home') {
      this.setHomeTab(e.event.user);
    }
  }

  /**
   * Sets the home tab for the user
   * This method is called when the user opens the app home tab
   *
   * @param userId - The user ID
   */
  async setHomeTab(userId: string) {
    const menuTree = await this.menuService.getTree();

    const view = this.formatHomeTab(menuTree);
    const data = await this.api.views.publish({
      view,
      user_id: userId,
    });

    if (!data.ok) {
      const errors = data.response_metadata?.messages;
      await this.api.views.publish({
        view: this.formatHomeTab(
          menuTree,
          errors ? this.buildInvalidContentBlocks(errors) : [],
        ),
        user_id: userId,
      });
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
    homeTabContent: SlackTypes.KnownBlock[] = this.homeTabContent,
  ): Slack.HomeTabView {
    const menuBlocks: SlackTypes.KnownBlock[] =
      menuTree.length > 0
        ? [
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
          ]
        : [];

    return {
      type: 'home',
      blocks: [
        ...homeTabContent,
        ...menuBlocks,
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
   *
   * @returns Slack blocks showing the errors
   */
  buildInvalidContentBlocks(errors: string[]): SlackTypes.KnownBlock[] {
    {
      const errorMessages = errors?.join('\n');
      const errorsBlock: SlackTypes.KnownBlock[] = errorMessages
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
  formatMenuBlocks(
    menuTree: MenuTree,
    level: number = 0,
  ): SlackTypes.KnownBlock[] {
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
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text,
            },
          },
          ...(item.call_to_actions
            ? this.formatMenuBlocks(item.call_to_actions || [], level + 1)
            : []),
        );
      }
      return acc;
    }, [] as SlackTypes.KnownBlock[]);
    return blocks;
  }

  /**
   * Parses the content of the home tab.
   *
   * @param content - The content of the home tab
   *
   * @returns Slack Blocks for the home tab
   */
  parseHomeTabContent(content: string): SlackTypes.KnownBlock[] {
    try {
      const parsedContent = JSON.parse(content);
      if (Array.isArray(parsedContent)) {
        return parsedContent as any as SlackTypes.KnownBlock[];
      }
      return [];
    } catch (e) {
      this.logger.warn('Invalid home tab content, using default content.');
      return this.buildInvalidContentBlocks(['Invalid JSON array']);
    }
  }

  /**
   * Updates the access token for the Slack API
   *
   * @param setting
   */
  @OnEvent('hook:slack_channel:access_token')
  async updateAccessToken(setting: SecretSetting) {
    this.api = new WebClient(setting?.value);
  }

  /**
   * Updates the content of the home tab
   *
   * @param setting
   */
  @OnEvent('hook:slack_channel:home_tab_content')
  updateHomeTabContent(setting: TextareaSetting) {
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
    req: RawBodyRequest<Request>,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const settings = await this.getSettings();
      this.verifySlackRequest({
        signingSecret: settings.signing_secret,
        body: req.rawBody as Buffer,
        headers: {
          'x-slack-signature': req.headers['x-slack-signature'] as string,
          'x-slack-request-timestamp': req.headers[
            'x-slack-request-timestamp'
          ] as string,
        },
      });
      next();
    } catch (e) {
      this.logger.error(e);
      res.status(401).send('Unauthorized!');
    }
  }

  /**
   * Verifies the authenticity of a Slack request by checking its timestamp
   * and signature against Slack's signing secret.
   *
   * This method ensures that the request is:
   * 1. Not stale by comparing the timestamp in the request header to the current system time.
   * 2. Signed correctly by validating the HMAC signature provided in the request header.
   *
   * @param options - The request verification options.
   */
  public verifySlackRequest(options: Slack.RequestVerificationOptions): void {
    const requestTimestampSec = parseInt(
      options.headers['x-slack-request-timestamp'].toString(),
    );
    const signature = options.headers['x-slack-signature'].toString();

    if (!requestTimestampSec || !signature) {
      throw new Error(`Missing signature headers`);
    }

    if (Number.isNaN(requestTimestampSec)) {
      throw new Error(
        `Header x-slack-request-timestamp did not have the expected type (${requestTimestampSec})`,
      );
    }

    // Calculate time-dependent values
    const nowMs = options.nowMilliseconds ?? Date.now();
    const maxStaleTimestampMinutes = options.requestTimestampMaxDeltaMin ?? 5; // Default to 5 minutes
    const staleTimestampThresholdSec =
      Math.floor(nowMs / 1000) - 60 * maxStaleTimestampMinutes;

    // Enforce verification rules

    // Rule 1: Check staleness
    if (requestTimestampSec < staleTimestampThresholdSec) {
      throw new Error(
        `x-slack-request-timestamp must differ from system time by no more than ${maxStaleTimestampMinutes} minutes or request is stale`,
      );
    }

    // Rule 2: Check signature
    // Separate parts of signature
    const [signatureVersion, signatureHash] = signature.split('=');
    // Only handle known versions
    if (signatureVersion !== 'v0') {
      throw new Error(`Unknown signature version`);
    }

    // Compute our own signature hash
    const hmac = createHmac('sha256', options.signingSecret);
    hmac.update(`${signatureVersion}:${requestTimestampSec}:${options.body}`);
    const ourSignatureHash = hmac.digest('hex');

    if (!signatureHash || !tsscmp(signatureHash, ourSignatureHash)) {
      throw new Error(
        `Signature mismatch\nA request was made to the slack api with an invalid signature. This could be a malicious request. Please check the request's origin. If this is a legitimate request, please check the slack signing secret in Slack API settings.`,
      );
    }
  }
}
