/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { createHmac } from 'crypto';

import { HttpService } from '@nestjs/axios';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import tsscmp from 'tsscmp';

import { LoggerService } from '@/logger/logger.service';

import { Slack } from './types';

const verifyErrorPrefix = 'Failed to verify slack event authenticity';

export interface SlackRequestVerificationOptions {
  signingSecret: string;
  body: string;
  headers: {
    'x-slack-signature': string;
    'x-slack-request-timestamp': number;
  };
  nowMilliseconds?: number;
  requestTimestampMaxDeltaMin?: number;
}

export class SlackApi {
  constructor(
    private httpService: HttpService,
    private logger: LoggerService,
    private access_token: string,
    private signing_secret: string,
  ) {}

  setAccessToken(access_token: string) {
    this.logger.verbose('Access token updated');
    this.access_token = access_token;
  }

  setSigningSecret(signing_secret: string) {
    this.logger.verbose('Signing secret updated');
    this.signing_secret = signing_secret;
  }

  async sendRequest<
    T extends Slack.SlackApiResponse = Slack.SlackApiResponse,
    D = any,
  >(
    config: AxiosRequestConfig<D> & { url: Slack.ApiEndpoint },
  ): Promise<AxiosResponse<T>> {
    try {
      const response = await this.httpService.axiosRef.request<T>({
        baseURL: 'https://slack.com/api',
        ...config,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Authorization: `Bearer ${this.access_token}`,
          ...config.headers,
        },
      });
      if (response.data.ok === false) {
        const errors = [
          ...(response.data.errors || []),
          ...(response.data.response_metadata?.messages || []),
        ];
        this.logger.error(
          `Slack API request failed: endpoint=${config.url}\n${response.data.error}${errors.length ? `: \n  ${errors.join('\n  ')}` : ''}`,
        );
      }
      return response;
    } catch (e) {
      this.logger.error(e);
    }
  }

  public verifySignature(req: any) {
    try {
      SlackApi.verifySlackRequest({
        signingSecret: this.signing_secret,
        body: req.rawBody,
        headers: {
          'x-slack-signature': req.headers['x-slack-signature'],
          'x-slack-request-timestamp': req.headers['x-slack-request-timestamp'],
        },
      });
      return true;
    } catch (e) {
      this.logger.error(e);
    }
  }

  async getUserInfo(userForeingId: string): Promise<Slack.User> {
    const { data } = await this.sendRequest<Slack.UsersInfoResponse>({
      method: 'GET',
      url: Slack.ApiEndpoint.usersInfo,
      params: { user: userForeingId },
    });
    return data.user;
  }

  async sendMessage(message: any, channel) {
    debugger;
    return await this.sendRequest({
      method: 'POST',
      url: Slack.ApiEndpoint.chatPostMessage,
      data: { channel, ...message },
    });
  }

  async getUploadURL(
    fileName: string,
    size: number,
  ): Promise<Slack.UploadUrlData> {
    const { data } = await this.sendRequest<Slack.UploadUrlData>({
      method: 'GET',
      url: Slack.ApiEndpoint.getUploadURL,
      params: { filename: fileName, length: size },
    });
    return data;
  }

  async uploadFile(uploadUrl: string, buffer: Buffer) {
    return await firstValueFrom(
      this.httpService.post(uploadUrl, buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      }),
    );
  }

  async CompleteUpload(files: any, channel_id?: string): Promise<Slack.File[]> {
    //TODO: remove any
    const { data } = await this.sendRequest<Slack.CompleteFileUploadResponse>({
      method: 'POST',
      url: Slack.ApiEndpoint.completeUpload,
      data: {
        channel_id,
        files,
      },
    });

    return data.files;
  }

  async sendResponse(message: any, responseUrl: string) {
    try {
      await this.httpService.post(responseUrl, message);
    } catch (e) {
      this.logger.error(e);
    }
  }

  async publishHomeTab(view: Slack.HomeTabView, user_id: string) {
    return await this.sendRequest({
      method: 'POST',
      url: Slack.ApiEndpoint.publishHomeTab,

      data: {
        view,
        user_id,
      },
    });
  }

  public static verifySlackRequest(
    options: SlackRequestVerificationOptions,
  ): void {
    const requestTimestampSec = options.headers['x-slack-request-timestamp'];
    const signature = options.headers['x-slack-signature'];

    if (!requestTimestampSec || !signature) {
      throw new Error(`${verifyErrorPrefix}: missing signature headers`);
    }

    if (Number.isNaN(requestTimestampSec)) {
      throw new Error(
        `${verifyErrorPrefix}: header x-slack-request-timestamp did not have the expected type (${requestTimestampSec})`,
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
        `${verifyErrorPrefix}: x-slack-request-timestamp must differ from system time by no more than ${maxStaleTimestampMinutes} minutes or request is stale`,
      );
    }

    // Rule 2: Check signature
    // Separate parts of signature
    const [signatureVersion, signatureHash] = signature.split('=');
    // Only handle known versions
    if (signatureVersion !== 'v0') {
      throw new Error(`${verifyErrorPrefix}: unknown signature version`);
    }
    // Compute our own signature hash
    const hmac = createHmac('sha256', options.signingSecret);
    hmac.update(`${signatureVersion}:${requestTimestampSec}:${options.body}`);
    const ourSignatureHash = hmac.digest('hex');
    if (!signatureHash || !tsscmp(signatureHash, ourSignatureHash)) {
      throw new Error(
        `${verifyErrorPrefix}: signature mismatch\nA request was made to the slack api with an invalid signature. This could be a malicious request. Please check the request's origin. If this is a legitimate request, please check the slack signing secret in Slack API settings.`,
      );
    }
  }
}
