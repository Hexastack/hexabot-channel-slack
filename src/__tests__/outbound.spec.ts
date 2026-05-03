/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ButtonType,
  FileType,
  OutgoingMessageType,
  StdOutgoingMessageEnvelope,
} from '@hexabot-ai/types';

import { SlackOutboundMessageEncoder } from '../outbound';

const i18n = {
  t: jest.fn((key: string) => key),
};

const encode = (
  encoder: SlackOutboundMessageEncoder,
  envelope: StdOutgoingMessageEnvelope,
) => encoder.encode(envelope, { sourceId: 'source-1' });

const listMessage = (
  overrides: Partial<Extract<StdOutgoingMessageEnvelope, { type: OutgoingMessageType.list }>['data']> = {},
): StdOutgoingMessageEnvelope =>
  ({
    type: OutgoingMessageType.list,
    data: {
      options: {
        display: 'list',
        fields: {
          title: 'title',
          subtitle: 'subtitle',
          image_url: 'image',
          url: 'url',
        },
        buttons: [
          {
            type: ButtonType.postback,
            title: 'Select',
            payload: 'SELECT',
          },
        ],
        limit: 10,
      },
      elements: [
        {
          id: 'item-1',
          title: 'Item 1',
          subtitle: 'First item',
          url: 'example.com/item-1',
        },
      ],
      pagination: {
        total: 1,
        skip: 0,
        limit: 10,
      },
      ...overrides,
    },
  }) as StdOutgoingMessageEnvelope;

describe('SlackOutboundMessageEncoder', () => {
  const encoder = new SlackOutboundMessageEncoder(i18n as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('encodes text messages', async () => {
    await expect(
      encode(encoder, {
        type: OutgoingMessageType.text,
        data: {
          text: '**Hello**',
        },
      }),
    ).resolves.toEqual({
      kind: 'message',
      text: '*Hello*',
    });
  });

  it('encodes quick replies as Block Kit actions', async () => {
    const message = await encode(encoder, {
      type: OutgoingMessageType.quickReply,
      data: {
        text: 'Pick one',
        quickReplies: [{ title: 'A', payload: 'A' }],
      },
    });

    expect(message).toMatchObject({
      kind: 'message',
      text: 'Pick one',
      blocks: [
        { type: 'section' },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              value: 'A',
              text: { text: 'A' },
            },
          ],
        },
      ],
    });
  });

  it('encodes postback and URL buttons', async () => {
    const message = await encode(encoder, {
      type: OutgoingMessageType.buttons,
      data: {
        text: 'Choose',
        buttons: [
          {
            type: ButtonType.web_url,
            title: 'Open',
            url: 'example.com',
          },
          {
            type: ButtonType.postback,
            title: 'Select',
            payload: 'SELECT',
          },
        ],
      },
    });
    const actions = (message as any).blocks[1].elements;

    expect(actions).toEqual([
      expect.objectContaining({
        type: 'button',
        value: 'url',
        url: 'https://example.com',
      }),
      expect.objectContaining({
        type: 'button',
        value: 'SELECT',
      }),
    ]);
  });

  it('encodes attachment upload instructions and follow-up quick replies', async () => {
    const message = await encode(encoder, {
      type: OutgoingMessageType.attachment,
      data: {
        attachment: {
          type: FileType.image,
          payload: {
            id: 'attachment-1',
          },
        },
        quickReplies: [{ title: 'Done', payload: 'DONE' }],
      },
    });

    expect(message).toMatchObject({
      kind: 'file',
      attachment: {
        id: 'attachment-1',
      },
      followUp: {
        kind: 'message',
        text: 'Options',
        blocks: [
          { type: 'section' },
          {
            type: 'actions',
            elements: [expect.objectContaining({ value: 'DONE' })],
          },
        ],
      },
    });
  });

  it('encodes lists with VIEW_MORE when pagination has more results', async () => {
    const message = await encode(
      encoder,
      listMessage({
        pagination: {
          total: 20,
          skip: 0,
          limit: 10,
        },
      } as any),
    );

    expect(message).toMatchObject({
      kind: 'message',
      blocks: expect.arrayContaining([
        {
          type: 'actions',
          elements: [expect.objectContaining({ value: 'VIEW_MORE' })],
        },
      ]),
    });
  });

  it('caps carousel blocks at 10 cards', async () => {
    const message = await encode(
      encoder,
      {
        ...listMessage({
          elements: Array.from({ length: 12 }, (_, index) => ({
            id: `item-${index}`,
            title: `Item ${index}`,
            subtitle: `Subtitle ${index}`,
          })),
        } as any),
        type: OutgoingMessageType.carousel,
      } as StdOutgoingMessageEnvelope,
    );
    const carousel = (message as any).blocks[0];

    expect(carousel.type).toBe('carousel');
    expect(carousel.elements).toHaveLength(10);
  });

  it('rejects action blocks that exceed Slack limits', async () => {
    await expect(
      encode(encoder, {
        type: OutgoingMessageType.buttons,
        data: {
          text: 'Too many',
          buttons: Array.from({ length: 26 }, (_, index) => ({
            type: ButtonType.postback,
            title: `Button ${index}`,
            payload: `B_${index}`,
          })),
        },
      }),
    ).rejects.toThrow('Slack supports up to 25 buttons');
  });
});
