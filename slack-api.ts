import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

import { token } from './settings';
import { Slack } from './types';

export class slackApi {
  private readonly httpService: HttpService;

  //TODO: handle api errors
  constructor() {
    const axiosInstance = axios.create({
      baseURL: 'https://slack.com/api',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
    console.log('sending message:', message, channel);
    const res = await firstValueFrom(
      this.httpService.post(Slack.ApiEndpoint.chatPostMessage, {
        channel,
        ...message,
      }),
    );
    console.log('res of sending message:', res);
  }
}
