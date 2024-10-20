import { access, ReadStream } from 'fs';

import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

import { Slack } from './types';

export class SlackApi {
  private httpService: HttpService;

  //TODO: handle api errors
  constructor(access_token: string) {
    this.buildHttpService(access_token);
  }

  setAccessToken(access_token: string) {
    this.buildHttpService(access_token);
  }

  private buildHttpService(access_token: string) {
    if (!access_token) {
      Logger.error('Slack Api: access token is missing');
    }
    const axiosInstance = axios.create({
      baseURL: 'https://slack.com/api',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
    });
    axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        Logger.error('Slack Api: Error', error);
        return Promise.reject(error); // Reject the promise to handle the error downstream
      },
    );
    this.httpService = new HttpService(axiosInstance);
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
    const res = await firstValueFrom(
      this.httpService.post(uploadUrl, buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      }),
    );
    debugger;
    return res; //TODO: to remove the res variable.
  }

  async CompleteUpload(files: any, channel_id: string) {
    //TODO: remove any
    const a = await firstValueFrom(
      this.httpService.post(Slack.ApiEndpoint.completeUpload, {
        channel_id,
        files,
      }),
    );
    debugger;
    return a;
  }

  async sendResponse(message: any, responseUrl: string) {
    try {
      await axios.post(responseUrl, message);
    } catch (e) {
      Logger.error('Slack Api: Error sending response', e);
    }
  }
}
