/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

import { LoggerService } from '@/logger/logger.service';

import { Slack } from './types';
import { verifySlackRequest } from './verify-request';

export class SlackApi {
  private httpService: HttpService;

  private logger = new LoggerService('Slack Api');

  constructor(
    access_token: string,
    private signing_secret: string,
  ) {
    this.buildHttpService(access_token);
  }

  setAccessToken(access_token: string) {
    this.logger.verbose('Access token updated');
    this.buildHttpService(access_token);
  }

  setSigningSecret(signing_secret: string) {
    this.logger.verbose('Signing secret updated');
    this.signing_secret = signing_secret;
  }

  private buildHttpService(access_token: string) {
    if (!access_token) {
      this.logger.error('Access token is missing');
    }
    const axiosInstance = axios.create({
      baseURL: 'https://slack.com/api',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Authorization: `Bearer ${access_token}`,
      },
    });
    axiosInstance.interceptors.response.use(
      (response) => {
        if (response.data.ok === false) {
          debugger;
          this.logger.error(
            `${response.data.error}: ${response.data.errors?.join(', ') || ''} \n   ${response.data.response_metadata?.messages?.join('\n   ') || ''}`,
          );
        }
        return response;
      },
      (error) => {
        this.logger.error(error);
      },
    );
    this.httpService = new HttpService(axiosInstance);
  }

  public verifySignature(req: any) {
    try {
      verifySlackRequest({
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
    const { data } = await firstValueFrom(
      this.httpService.get(Slack.ApiEndpoint.usersInfo, {
        params: { user: userForeingId },
      }),
    );
    return data.user;
  }

  async sendMessage(message: any, channel) {
    return await firstValueFrom(
      this.httpService.post(Slack.ApiEndpoint.chatPostMessage, {
        channel,
        ...message,
      }),
    );
  }

  async getUploadURL(
    fileName: string,
    size: number,
  ): Promise<Slack.UploadUrlData> {
    const { data } = await firstValueFrom(
      this.httpService.get(Slack.ApiEndpoint.getUploadURL, {
        params: { filename: fileName, length: size },
      }),
    );
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
    const { data } = await firstValueFrom(
      this.httpService.post(Slack.ApiEndpoint.completeUpload, {
        channel_id,
        files,
      }),
    );
    return data.files;
  }

  async sendResponse(message: any, responseUrl: string) {
    try {
      await axios.post(responseUrl, message);
    } catch (e) {
      this.logger.error(e);
    }
  }

  async publishHomeTab(view: Slack.HomeTabView, user_id: string) {
    return await firstValueFrom(
      this.httpService.post(Slack.ApiEndpoint.publishHomeTab, {
        view,
        user_id,
      }),
    );
  }
}
