/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Readable } from 'stream';

import { AttachmentFile } from '@hexabot-ai/api';
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { WebAPICallResult, WebClient } from '@slack/web-api';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

import { SlackResolvedChannelSettings } from '../settings.schema';
import { Slack } from '../types';

type SlackPlatformError = Error & {
  data?: {
    ok?: false;
    error?: string;
  };
};

@Injectable()
export class SlackApiService {
  constructor(private readonly httpService: HttpService) {}

  protected createClient(token: string): WebClient {
    return new WebClient(token);
  }

  async postMessage(
    settings: SlackResolvedChannelSettings,
    payload: Slack.PostMessagePayload,
    autoJoinPublicChannels = false,
  ): Promise<Slack.SendMessageResponse> {
    const client = this.createClient(settings.bot_token);

    try {
      const response = await client.chat.postMessage(payload as any);

      return {
        ts: response.ts,
        channel: response.channel,
      };
    } catch (err) {
      if (
        this.getPlatformError(err) !== 'not_in_channel' ||
        !autoJoinPublicChannels ||
        !this.isPublicChannel(payload.channel)
      ) {
        throw err;
      }

      await client.conversations.join({ channel: payload.channel });
      const response = await client.chat.postMessage(payload as any);

      return {
        ts: response.ts,
        channel: response.channel,
      };
    }
  }

  async uploadFile(
    settings: SlackResolvedChannelSettings,
    payload: Slack.FileUploadPayload,
  ): Promise<Slack.FileUploadResponse> {
    const response = (await this.createClient(settings.bot_token).filesUploadV2(
      payload as any,
    )) as WebAPICallResult & {
      files?: Array<{ id?: string; shares?: Record<string, unknown> }>;
      file?: { id?: string };
    };
    const fileId = response.files?.[0]?.id ?? response.file?.id;

    return {
      fileId,
      ts: this.findUploadMessageTs(response),
    };
  }

  async getUserInfo(
    settings: SlackResolvedChannelSettings,
    userId: string,
  ): Promise<Slack.UserInfo> {
    const response = await this.createClient(settings.bot_token).users.info({
      user: userId,
    });

    return (response.user ?? {}) as Slack.UserInfo;
  }

  async getConversationInfo(
    settings: SlackResolvedChannelSettings,
    channelId: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.createClient(
      settings.bot_token,
    ).conversations.info({
      channel: channelId,
    });

    return (response.channel ?? {}) as Record<string, unknown>;
  }

  async openConversation(
    settings: SlackResolvedChannelSettings,
    userId: string,
  ): Promise<string> {
    const response = await this.createClient(
      settings.bot_token,
    ).conversations.open({
      users: userId,
      return_im: true,
    });
    const channelId = response.channel?.id;

    if (!channelId) {
      throw new Error('Slack conversations.open did not return a channel id');
    }

    return channelId;
  }

  async joinConversation(
    settings: SlackResolvedChannelSettings,
    channelId: string,
  ): Promise<void> {
    await this.createClient(settings.bot_token).conversations.join({
      channel: channelId,
    });
  }

  async publishHomeTab(
    settings: SlackResolvedChannelSettings,
    userId: string,
    view: Slack.HomeTabView,
  ): Promise<void> {
    await this.createClient(settings.bot_token).views.publish({
      user_id: userId,
      view: view as any,
    });
  }

  async authTest(
    settings: SlackResolvedChannelSettings,
  ): Promise<Record<string, unknown>> {
    return (await this.createClient(
      settings.bot_token,
    ).auth.test()) as unknown as Record<string, unknown>;
  }

  async downloadSlackFile(
    settings: Pick<SlackResolvedChannelSettings, 'bot_token'>,
    file: Slack.UploadedFile,
  ): Promise<AttachmentFile> {
    const url = file.url_private_download ?? file.url_private;

    if (!url) {
      throw new Error(`Slack file ${file.id} has no private download URL`);
    }

    const response = await firstValueFrom(
      this.httpService.get<Readable>(url, {
        responseType: 'stream',
        headers: {
          Authorization: `Bearer ${settings.bot_token}`,
        },
      }),
    );

    return this.toAttachmentFile(response, file.name ?? file.title ?? file.id);
  }

  async downloadUrl(url: string, name?: string): Promise<AttachmentFile> {
    const response = await firstValueFrom(
      this.httpService.get<Readable>(url, {
        responseType: 'stream',
      }),
    );

    return this.toAttachmentFile(response, name);
  }

  private getPlatformError(err: unknown): string | undefined {
    return (err as SlackPlatformError).data?.error;
  }

  private isPublicChannel(channelId: string): boolean {
    return channelId.startsWith('C');
  }

  private findUploadMessageTs(
    response: WebAPICallResult & { files?: Array<Record<string, any>> },
  ): string | undefined {
    const shares = response.files?.[0]?.shares;

    if (!shares || typeof shares !== 'object') {
      return undefined;
    }

    for (const value of Object.values(shares)) {
      if (!value || typeof value !== 'object') {
        continue;
      }

      for (const entries of Object.values(value as Record<string, unknown>)) {
        if (Array.isArray(entries) && entries[0]?.ts) {
          return String(entries[0].ts);
        }
      }
    }

    return undefined;
  }

  private toAttachmentFile(
    response: AxiosResponse<Readable>,
    name?: string,
  ): AttachmentFile {
    const contentType = String(
      response.headers['content-type'] ?? 'application/octet-stream',
    ).split(';')[0];
    const contentLength = Number(response.headers['content-length'] ?? 0);

    return {
      file: response.data,
      name,
      size: Number.isFinite(contentLength) ? contentLength : 0,
      type: contentType,
    };
  }
}

export default SlackApiService;
