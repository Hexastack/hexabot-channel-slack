/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

import { Slack } from './types';
import { verifySlackRequest } from './verify-request';

export class SlackApi {
  private httpService: HttpService;

  //TODO: handle api errors
  constructor(
    access_token: string,
    private signing_secret: string,
  ) {
    this.buildHttpService(access_token);
  }

  setAccessToken(access_token: string) {
    Logger.verbose('Access token updated', 'Slack Api');
    this.buildHttpService(access_token);
  }

  setSigningSecret(signing_secret: string) {
    Logger.verbose('Signing secret updated', 'Slack Api');
    this.signing_secret = signing_secret;
  }

  private buildHttpService(access_token: string) {
    if (!access_token) {
      Logger.error('Access token is missing', 'Error: Slack Api');
    }
    const axiosInstance = axios.create({
      baseURL: 'https://slack.com/api',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
    });
    axiosInstance.interceptors.response.use(
      (response) => {
        if (response.data.ok === false) {
          debugger; //
          Logger.error(
            `${response.data.error}: ${response.data.errors?.join(', ')}`,
            'Error: Slack API',
          );
        }
        return response;
      },
      (error) => {
        debugger; //
        Logger.error(error, 'Error: Slack Api');
      },
    );
    this.httpService = new HttpService(axiosInstance);
  }

  public verifySignature(req: any) {
    try {
      verifySlackRequest({
        signingSecret: this.signing_secret,
        //body: req.body,// take the raw body instead
        body: req.rawBody,
        headers: {
          'x-slack-signature': req.headers['x-slack-signature'],
          'x-slack-request-timestamp': req.headers['x-slack-request-timestamp'],
        },
      });
      return true;
    } catch (e) {
      Logger.error(e, 'Error: Slack Api');
    }
  }

  async getUserInfo(userForeingId: string): Promise<any> {
    return (
      await firstValueFrom(
        this.httpService.get(Slack.ApiEndpoint.usersInfo, {
          params: { user: userForeingId },
        }),
      )
    ).data.user;
  }

  async sendMessage(message: any, channel) {
    await firstValueFrom(
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
    return (
      await firstValueFrom(
        this.httpService.get(Slack.ApiEndpoint.getUploadURL, {
          params: { filename: fileName, length: size },
        }),
      )
    ).data;
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
    return (
      await firstValueFrom(
        this.httpService.post(Slack.ApiEndpoint.completeUpload, {
          channel_id,
          files,
        }),
      )
    ).data.files;
  }

  async sendResponse(message: any, responseUrl: string) {
    try {
      await axios.post(responseUrl, message);
    } catch (e) {
      Logger.error(e, 'Error: Slack Api');
    }
  }
}
