/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Readable, Stream } from 'stream';

import type { AttachmentRef } from '@hexabot-ai/types';
import { z } from 'zod';

export namespace Slack {
  export type ConversationType =
    | 'channel'
    | 'group'
    | 'im'
    | 'mpim'
    | 'app_home'
    | string;

  export type ChannelAttrs = {
    teamId: string;
    enterpriseId?: string;
    appId: string;
    conversationId: string;
    conversationType: ConversationType;
    userId: string;
    messageTs?: string;
    threadTs?: string;
  };

  export type Block = Record<string, unknown>;

  export type HomeTabView = {
    type: 'home';
    blocks: Block[];
    callback_id?: string;
    private_metadata?: string;
  };

  export type OutboundMessage = {
    kind: 'message';
    text?: string;
    blocks?: Block[];
  };

  export type OutboundFile = {
    kind: 'file';
    attachment: AttachmentRef;
    filename?: string;
    initialComment?: string;
    blocks?: Block[];
    followUp?: OutboundMessage;
  };

  export type Outbound = OutboundMessage | OutboundFile;

  export type PostMessagePayload = {
    channel: string;
    text?: string;
    blocks?: Block[];
    thread_ts?: string;
    unfurl_links?: boolean;
    unfurl_media?: boolean;
  };

  export type FileUploadPayload = {
    channel_id: string;
    file: Buffer | Stream | Readable;
    filename: string;
    initial_comment?: string;
    blocks?: Block[];
    thread_ts?: string;
  };

  export type SendMessageResponse = {
    ts?: string;
    channel?: string;
  };

  export type FileUploadResponse = {
    ts?: string;
    fileId?: string;
  };

  export type UserProfile = {
    first_name?: string;
    last_name?: string;
    display_name?: string;
    real_name?: string;
    image_original?: string;
    image_1024?: string;
    image_512?: string;
    image_192?: string;
    image_72?: string;
    image_48?: string;
    pronouns?: string;
    [key: string]: unknown;
  };

  export type UserInfo = {
    id?: string;
    name?: string;
    real_name?: string;
    tz_offset?: number;
    locale?: string;
    profile?: UserProfile;
  };

  const nullableString = z.string().nullable().optional();

  export const uploadedFileSchema = z.looseObject({
    id: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    mimetype: z.string().optional(),
    filetype: z.string().optional(),
    size: z.number().optional(),
    url_private: z.string().optional(),
    url_private_download: z.string().optional(),
  });

  export type UploadedFile = z.infer<typeof uploadedFileSchema>;

  export const eventCallbackSchema = z.looseObject({
    token: z.string().optional(),
    team_id: z.string().optional(),
    enterprise_id: nullableString,
    api_app_id: z.string(),
    type: z.literal('event_callback'),
    event_id: z.string(),
    event_time: z.number().optional(),
    event: z.looseObject({
      type: z.string(),
      channel: z.string().optional(),
      user: z.string().optional(),
      text: z.string().optional(),
      ts: z.string().optional(),
      event_ts: z.string().optional(),
      thread_ts: z.string().optional(),
      channel_type: z.string().optional(),
      bot_id: z.string().optional(),
      subtype: z.string().optional(),
      tab: z.string().optional(),
      files: z.array(uploadedFileSchema).optional(),
    }),
    authorizations: z
      .array(
        z.looseObject({
          enterprise_id: nullableString,
          team_id: nullableString,
          user_id: z.string().optional(),
          is_bot: z.boolean().optional(),
          is_enterprise_install: z.boolean().optional(),
        }),
      )
      .optional(),
  });

  export type EventCallback = z.infer<typeof eventCallbackSchema>;

  export const urlVerificationSchema = z.looseObject({
    token: z.string().optional(),
    challenge: z.string(),
    type: z.literal('url_verification'),
  });

  export type UrlVerification = z.infer<typeof urlVerificationSchema>;

  export const plainTextElementSchema = z.looseObject({
    type: z.string().optional(),
    text: z.string(),
  });

  export const blockActionElementSchema = z.looseObject({
    type: z.string(),
    value: z.string().optional(),
    url: z.string().optional(),
    action_id: z.string().optional(),
    action_ts: z.string().optional(),
    text: plainTextElementSchema.optional(),
  });

  export type BlockActionElement = z.infer<typeof blockActionElementSchema>;

  export const blockActionSchema = z.looseObject({
    type: z.literal('block_actions'),
    team: z
      .looseObject({
        id: z.string(),
        domain: z.string().optional(),
      })
      .nullable()
      .optional(),
    enterprise: z
      .looseObject({
        id: z.string(),
        name: z.string().optional(),
      })
      .nullable()
      .optional(),
    user: z.looseObject({
      id: z.string(),
      username: z.string().optional(),
      name: z.string().optional(),
      team_id: z.string().optional(),
    }),
    channel: z
      .looseObject({
        id: z.string(),
        name: z.string().optional(),
      })
      .optional(),
    message: z
      .looseObject({
        type: z.string().optional(),
        user: z.string().optional(),
        ts: z.string().optional(),
        thread_ts: z.string().optional(),
        text: z.string().optional(),
      })
      .optional(),
    view: z
      .looseObject({
        id: z.string().optional(),
        type: z.string().optional(),
        callback_id: z.string().optional(),
      })
      .optional(),
    api_app_id: z.string(),
    token: z.string().optional(),
    trigger_id: z.string().optional(),
    response_url: z.string().optional(),
    actions: z.array(blockActionElementSchema).default([]),
    container: z.looseObject({ type: z.string().optional() }).optional(),
  });

  export type BlockAction = z.infer<typeof blockActionSchema>;

  export const incomingPayloadSchema = z.union([
    urlVerificationSchema,
    eventCallbackSchema,
    blockActionSchema,
  ]);

  export type IncomingPayload = z.infer<typeof incomingPayloadSchema>;
}
