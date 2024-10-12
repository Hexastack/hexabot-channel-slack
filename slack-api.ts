import { access } from 'fs';

import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

import { Slack } from './types';

export class slackApi {
  private readonly httpService: HttpService;

  //TODO: handle api errors
  constructor(access_token: string) {
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
    axiosInstance.interceptors.request.use((config) => {
      console.log('sending Requesssst:', config);
      return config;
    });
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
    const res = await firstValueFrom(
      this.httpService.post(Slack.ApiEndpoint.chatPostMessage, {
        channel,
        ...message,
      }),
    );
  }
}
