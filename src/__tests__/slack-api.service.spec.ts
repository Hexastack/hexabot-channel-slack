/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Readable } from 'stream';

import { of } from 'rxjs';

import { SlackApiService } from '../services';
import { SlackResolvedChannelSettings } from '../settings.schema';

class TestSlackApiService extends SlackApiService {
  constructor(
    httpService: ConstructorParameters<typeof SlackApiService>[0],
    private readonly client: unknown,
  ) {
    super(httpService);
  }

  protected override createClient() {
    return this.client as any;
  }
}

const settings: SlackResolvedChannelSettings = {
  bot_token: 'xoxb-token',
  signing_secret: 'secret',
  app_id: 'A1',
  team_id: 'T1',
  home_tab_content: '[]',
  enable_home_tab: true,
  reply_in_threads: true,
  auto_join_public_channels: true,
  thread_inactivity_hours: 24,
};

describe('SlackApiService', () => {
  it('downloads private Slack files with bot token authorization', async () => {
    const stream = Readable.from(['file']);
    const httpService = {
      get: jest.fn(() =>
        of({
          data: stream,
          headers: {
            'content-type': 'application/pdf; charset=utf-8',
            'content-length': '4',
          },
        }),
      ),
    };
    const service = new SlackApiService(httpService as any);

    await expect(
      service.downloadSlackFile(settings, {
        id: 'F1',
        name: 'report.pdf',
        url_private_download: 'https://files.slack.com/report.pdf',
      }),
    ).resolves.toMatchObject({
      file: stream,
      name: 'report.pdf',
      size: 4,
      type: 'application/pdf',
    });
    expect(httpService.get).toHaveBeenCalledWith(
      'https://files.slack.com/report.pdf',
      expect.objectContaining({
        responseType: 'stream',
        headers: {
          Authorization: 'Bearer xoxb-token',
        },
      }),
    );
  });

  it('joins public channels and retries once after not_in_channel', async () => {
    const notInChannel = Object.assign(new Error('not_in_channel'), {
      data: {
        ok: false,
        error: 'not_in_channel',
      },
    });
    const client = {
      chat: {
        postMessage: jest
          .fn()
          .mockRejectedValueOnce(notInChannel)
          .mockResolvedValueOnce({ ts: '1710000002.000000', channel: 'C1' }),
      },
      conversations: {
        join: jest.fn(async () => ({ ok: true })),
      },
    };
    const service = new TestSlackApiService({} as any, client);

    await expect(
      service.postMessage(
        settings,
        {
          channel: 'C1',
          text: 'hello',
        },
        true,
      ),
    ).resolves.toEqual({
      ts: '1710000002.000000',
      channel: 'C1',
    });
    expect(client.conversations.join).toHaveBeenCalledWith({ channel: 'C1' });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('does not auto-join DMs on not_in_channel', async () => {
    const notInChannel = Object.assign(new Error('not_in_channel'), {
      data: {
        ok: false,
        error: 'not_in_channel',
      },
    });
    const client = {
      chat: {
        postMessage: jest.fn().mockRejectedValueOnce(notInChannel),
      },
      conversations: {
        join: jest.fn(),
      },
    };
    const service = new TestSlackApiService({} as any, client);

    await expect(
      service.postMessage(
        settings,
        {
          channel: 'D1',
          text: 'hello',
        },
        true,
      ),
    ).rejects.toThrow('not_in_channel');
    expect(client.conversations.join).not.toHaveBeenCalled();
  });
});
