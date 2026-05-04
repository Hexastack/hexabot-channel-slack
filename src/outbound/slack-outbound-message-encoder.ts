/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ChannelOutboundMessageEncoder,
  ContentOrmEntity,
  I18nService,
} from '@hexabot-ai/api';
import {
  ActionOptions,
  AttachmentRef,
  Button,
  ButtonType,
  ContentElement,
  OutgoingMessageType,
  StdOutgoingAttachmentMessageData,
  StdOutgoingButtonsMessageData,
  StdOutgoingListMessageData,
  StdOutgoingMessageEnvelope,
  StdOutgoingQuickRepliesMessageData,
  StdOutgoingTextMessageData,
} from '@hexabot-ai/types';
import { Injectable, Type } from '@nestjs/common';

import { Slack } from '../types';

export type SlackSourceScopedEncodeOptions = ActionOptions & {
  sourceId: string;
};

const SLACK_ACTION_BLOCK_ELEMENT_LIMIT = 25;
const SLACK_MESSAGE_BLOCK_LIMIT = 50;
const SLACK_CAROUSEL_CARD_LIMIT = 10;
const VIEW_MORE_PAYLOAD = 'VIEW_MORE';

export class SlackOutboundMessageEncoder extends ChannelOutboundMessageEncoder<
  Slack.Outbound,
  SlackSourceScopedEncodeOptions
> {
  constructor(private readonly i18n: I18nService) {
    super();
  }

  async encode(
    envelope: StdOutgoingMessageEnvelope,
    options: SlackSourceScopedEncodeOptions,
  ): Promise<Slack.Outbound> {
    if (!options?.sourceId) {
      throw new Error('Missing sourceId in outbound encode options');
    }

    return await this.dispatchEnvelope(envelope, options, {
      [OutgoingMessageType.text]: ({ data }) => this.encodeTextMessage(data),
      [OutgoingMessageType.quickReply]: ({ data }) =>
        this.encodeQuickRepliesMessage(data),
      [OutgoingMessageType.buttons]: ({ data }) =>
        this.encodeButtonsMessage(data),
      [OutgoingMessageType.attachment]: ({ data }) =>
        this.encodeAttachmentMessage(data),
      [OutgoingMessageType.list]: ({ data }, actionOptions) =>
        this.encodeListMessage(data, actionOptions),
      [OutgoingMessageType.carousel]: ({ data }, actionOptions) =>
        this.encodeCarouselMessage(data, actionOptions),
    });
  }

  protected encodeTextMessage(
    message: StdOutgoingTextMessageData,
  ): Slack.OutboundMessage {
    return {
      kind: 'message',
      text: this.toSlackMrkdwn(message.text),
    };
  }

  protected encodeQuickRepliesMessage(
    message: StdOutgoingQuickRepliesMessageData,
  ): Slack.OutboundMessage {
    return this.encodeActionsMessage(
      message.text,
      message.quickReplies.map(({ title, payload }) => ({
        type: ButtonType.postback,
        title,
        payload,
      })),
    );
  }

  protected encodeButtonsMessage(
    message: StdOutgoingButtonsMessageData,
  ): Slack.OutboundMessage {
    if (message.buttons.length === 0) {
      throw new Error('Slack buttons message requires at least one button');
    }

    return this.encodeActionsMessage(message.text, message.buttons);
  }

  protected encodeAttachmentMessage(
    message: StdOutgoingAttachmentMessageData,
  ): Slack.OutboundFile {
    const followUp =
      message.quickReplies && message.quickReplies.length > 0
        ? this.encodeQuickRepliesMessage({
            text: this.i18n.t('Options'),
            quickReplies: message.quickReplies,
          })
        : undefined;

    return {
      kind: 'file',
      attachment: message.attachment.payload,
      followUp,
    };
  }

  protected encodeListMessage(
    message: StdOutgoingListMessageData,
    options: SlackSourceScopedEncodeOptions,
  ): Slack.OutboundMessage {
    if (!message.elements.length) {
      throw new Error('Slack list message requires at least one element');
    }

    const fields = options.content?.fields ?? message.options.fields;

    if (!fields?.title) {
      throw new Error('Content options are missing the title field');
    }

    const buttons = options.content?.buttons ?? message.options.buttons ?? [];
    const hasMore =
      message.pagination.total -
        message.pagination.skip -
        message.pagination.limit >
      0;
    const blocks: Slack.Block[] = [];
    const reservedBlocks = hasMore ? 1 : 0;

    for (const item of message.elements) {
      const itemBlocks = this.encodeContentItemBlocks(item, fields, buttons);

      if (blocks.length + itemBlocks.length + reservedBlocks > SLACK_MESSAGE_BLOCK_LIMIT) {
        break;
      }

      blocks.push(...itemBlocks);
    }

    if (hasMore) {
      blocks.push({
        type: 'actions',
        elements: [
          this.encodePostbackButton({
            title: this.i18n.t('View More'),
            payload: VIEW_MORE_PAYLOAD,
          }),
        ],
      });
    }

    return {
      kind: 'message',
      blocks,
      text: this.i18n.t('Options'),
    };
  }

  protected encodeCarouselMessage(
    message: StdOutgoingListMessageData,
    options: SlackSourceScopedEncodeOptions,
  ): Slack.OutboundMessage {
    if (!message.elements.length) {
      throw new Error('Slack carousel message requires at least one element');
    }

    const fields = options.content?.fields ?? message.options.fields;

    if (!fields?.title) {
      throw new Error('Content options are missing the title field');
    }

    const buttons = options.content?.buttons ?? message.options.buttons ?? [];
    const elements = message.elements
      .slice(0, SLACK_CAROUSEL_CARD_LIMIT)
      .map((item, index) =>
        this.encodeCarouselCard(item, fields, buttons, index),
      );

    return {
      kind: 'message',
      text: this.i18n.t('Options'),
      blocks: [
        {
          type: 'carousel',
          elements,
        },
      ],
    };
  }

  private encodeActionsMessage(
    text: string,
    buttons: Button[],
  ): Slack.OutboundMessage {
    if (buttons.length === 0) {
      throw new Error('Slack action message requires at least one button');
    }

    if (buttons.length > SLACK_ACTION_BLOCK_ELEMENT_LIMIT) {
      throw new Error(
        `Slack supports up to ${SLACK_ACTION_BLOCK_ELEMENT_LIMIT} buttons per action block`,
      );
    }

    return {
      kind: 'message',
      text: this.toSlackMrkdwn(text),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: this.toSlackMrkdwn(text),
          },
        },
        {
          type: 'actions',
          elements: buttons.map((button) => this.encodeButton(button)),
        },
      ],
    };
  }

  private encodeContentItemBlocks(
    item: ContentElement,
    fields: NonNullable<ActionOptions['content']>['fields'],
    buttons: Button[],
  ): Slack.Block[] {
    const title = this.stringifyField(item[fields.title]);
    const subtitle =
      fields.subtitle && item[fields.subtitle] !== undefined
        ? this.stringifyField(item[fields.subtitle])
        : '';
    const text = subtitle
      ? `*${this.escapeMrkdwn(title)}*\n${this.escapeMrkdwn(subtitle)}`
      : `*${this.escapeMrkdwn(title)}*`;
    const section: Slack.Block = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text,
      },
    };
    const imageUrl = this.resolveImageUrl(item, fields);

    if (imageUrl) {
      section.accessory = {
        type: 'image',
        image_url: imageUrl,
        alt_text: title || this.i18n.t('Image'),
      };
    }

    const blocks: Slack.Block[] = [section];
    const actions = buttons.map((button, index) =>
      this.encodeContentButton(button, index, item, fields),
    );

    if (actions.length > 0) {
      if (actions.length > SLACK_ACTION_BLOCK_ELEMENT_LIMIT) {
        throw new Error(
          `Slack supports up to ${SLACK_ACTION_BLOCK_ELEMENT_LIMIT} buttons per action block`,
        );
      }

      blocks.push({
        type: 'actions',
        elements: actions,
      });
    }

    blocks.push({ type: 'divider' });

    return blocks;
  }

  private encodeCarouselCard(
    item: ContentElement,
    fields: NonNullable<ActionOptions['content']>['fields'],
    buttons: Button[],
    index: number,
  ): Slack.Block {
    const title = this.stringifyField(item[fields.title]);
    const subtitle =
      fields.subtitle && item[fields.subtitle] !== undefined
        ? this.stringifyField(item[fields.subtitle])
        : '';
    const imageUrl = this.resolveImageUrl(item, fields);
    const actions = buttons
      .slice(0, 5)
      .map((button, buttonIndex) =>
        this.encodeContentButton(button, buttonIndex, item, fields),
      );

    return {
      type: 'card',
      block_id: `slack-card-${index}`,
      title: {
        type: 'mrkdwn',
        text: this.escapeMrkdwn(title),
      },
      ...(subtitle
        ? {
            subtitle: {
              type: 'mrkdwn',
              text: this.escapeMrkdwn(subtitle),
            },
          }
        : {}),
      ...(imageUrl
        ? {
            hero_image: {
              type: 'image',
              image_url: imageUrl,
              alt_text: title || this.i18n.t('Image'),
            },
          }
        : {}),
      ...(actions.length > 0 ? { actions } : {}),
    };
  }

  private encodeContentButton(
    button: Button,
    index: number,
    item: ContentElement,
    fields: NonNullable<ActionOptions['content']>['fields'],
  ): Slack.Block {
    const btn = { ...button };

    if (
      index === 0 &&
      fields.action_title &&
      item[fields.action_title] !== undefined
    ) {
      btn.title = this.stringifyField(item[fields.action_title]);
    }

    if (btn.type === ButtonType.web_url) {
      const urlField = fields.url;
      const url =
        urlField && item[urlField]
          ? this.stringifyField(item[urlField])
          : ContentOrmEntity.getUrl(item);

      return this.encodeButton({
        ...btn,
        url,
      });
    }

    const payload =
      fields.action_payload && item[fields.action_payload] !== undefined
        ? `${btn.title}:${this.stringifyField(item[fields.action_payload])}`
        : `${btn.title}:${ContentOrmEntity.getPayload(item)}`;

    return this.encodeButton({
      ...btn,
      payload,
    });
  }

  private encodeButton(button: Button): Slack.Block {
    if (button.type === ButtonType.web_url) {
      return {
        type: 'button',
        text: {
          type: 'plain_text',
          text: button.title,
          emoji: true,
        },
        value: 'url',
        url: this.ensureHttpUrl(button.url),
      };
    }

    return this.encodePostbackButton(button);
  }

  private encodePostbackButton(button: {
    title: string;
    payload: string;
  }): Slack.Block {
    return {
      type: 'button',
      text: {
        type: 'plain_text',
        text: button.title,
        emoji: true,
      },
      value: button.payload,
    };
  }

  private resolveImageUrl(
    item: ContentElement,
    fields: NonNullable<ActionOptions['content']>['fields'],
  ): string | undefined {
    if (!fields.image_url || !item[fields.image_url]) {
      return undefined;
    }

    const value = item[fields.image_url];

    if (typeof value === 'string') {
      return value;
    }

    const attachmentRef = (value as { payload?: AttachmentRef }).payload;

    return attachmentRef && 'url' in attachmentRef ? attachmentRef.url : undefined;
  }

  private toSlackMrkdwn(value: string): string {
    return value.split('**').join('*');
  }

  private escapeMrkdwn(value: string): string {
    return value
      .split('&')
      .join('&amp;')
      .split('<')
      .join('&lt;')
      .split('>')
      .join('&gt;');
  }

  private stringifyField(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
  }

  private ensureHttpUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }
}

export function createSlackOutboundMessageEncoder(
  _channelName: string,
): Type<SlackOutboundMessageEncoder> {
  @Injectable()
  class BoundSlackOutboundMessageEncoder extends SlackOutboundMessageEncoder {
    constructor(i18n: I18nService) {
      super(i18n);
    }
  }

  return BoundSlackOutboundMessageEncoder;
}

export default SlackOutboundMessageEncoder;
