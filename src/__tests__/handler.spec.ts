/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHmac } from 'crypto';

import type { Source } from '@hexabot-ai/types';
import { Request, Response } from 'express';

import { SlackInboundEventDecoder } from '../inbound';
import SlackChannelHandler from '../index.channel';
import { SLACK_CHANNEL_NAME } from '../settings.schema';

type RawBodyRequest = Request & {
  rawBody?: string;
};

class TestSlackChannelHandler extends SlackChannelHandler {
  callVerifySignature(req: Request, source: Source) {
    return this.verifySignature(req, {} as Response, source);
  }

  callDecode(req: Request, source: Source) {
    return this.decode(req, source);
  }
}

const source = {
  id: 'source-1',
  channel: SLACK_CHANNEL_NAME,
  state: true,
  settings: {
    bot_token: 'credential-bot-token',
    signing_secret: 'credential-signing-secret',
    app_id: 'A1',
    team_id: 'T1',
  },
} as unknown as Source;

const credentialValues: Record<string, string> = {
  'credential-bot-token': 'xoxb-token',
  'credential-signing-secret': 'secret',
};

const buildSignedRequest = (
  body: unknown,
  timestamp = Math.floor(Date.now() / 1000).toString(),
  secret = 'secret',
): RawBodyRequest => {
  const rawBody = JSON.stringify(body);
  const digest = createHmac('sha256', secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');

  return {
    method: 'POST',
    body,
    rawBody,
    query: {},
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${digest}`,
    },
  } as unknown as RawBodyRequest;
};

const buildResponse = () =>
  ({
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
    sendStatus: jest.fn(),
  }) as unknown as Response;

describe('SlackChannelHandler webhook security and decoding', () => {
  let handler: TestSlackChannelHandler;

  beforeEach(() => {
    handler = new TestSlackChannelHandler();
    (handler as any).logger = {
      warn: jest.fn(),
      error: jest.fn(),
    };
    (handler as any).credentialService = {
      findOneValue: jest.fn(
        async (credentialId: string) => credentialValues[credentialId] ?? '',
      ),
    };
    (handler as any).inboundEventDecoder = new SlackInboundEventDecoder(
      SLACK_CHANNEL_NAME,
    );
    (handler as any).slackApi = {
      openConversation: jest.fn(async () => 'D-home'),
      publishHomeTab: jest.fn(async () => undefined),
      getUserInfo: jest.fn(async () => ({})),
    };
    (handler as any).menuService = {
      getTree: jest.fn(async () => []),
    };
    (handler as any).languageService = {
      getDefaultLanguage: jest.fn(async () => ({ code: 'en' })),
    };
  });

  it('accepts valid Slack signatures', async () => {
    const req = buildSignedRequest({ type: 'url_verification', challenge: 'ok' });

    await expect(
      handler.callVerifySignature(req, source),
    ).resolves.toBeUndefined();
  });

  it('rejects stale Slack timestamps', async () => {
    const staleTimestamp = (Math.floor(Date.now() / 1000) - 301).toString();
    const req = buildSignedRequest(
      { type: 'url_verification', challenge: 'old' },
      staleTimestamp,
    );

    await expect(handler.callVerifySignature(req, source)).rejects.toThrow(
      'Stale Slack request timestamp',
    );
  });

  it('rejects invalid Slack signatures', async () => {
    const req = buildSignedRequest({ type: 'url_verification', challenge: 'bad' });
    req.headers['x-slack-signature'] = 'v0=bad';

    await expect(handler.callVerifySignature(req, source)).rejects.toThrow(
      'Invalid Slack webhook signature',
    );
  });

  it('rejects requests missing raw body', async () => {
    const req = buildSignedRequest({ type: 'url_verification', challenge: 'raw' });
    delete req.rawBody;

    await expect(handler.callVerifySignature(req, source)).rejects.toThrow(
      'Missing raw request body',
    );
  });

  it('responds to URL verification with the plaintext challenge', async () => {
    const req = buildSignedRequest({
      type: 'url_verification',
      challenge: 'challenge-code',
    });
    const res = buildResponse();

    await handler.handle(req, res, source);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('challenge-code');
  });

  it('ignores payloads for other app IDs and teams', async () => {
    const event = {
      type: 'event_callback',
      api_app_id: 'OTHER_APP',
      team_id: 'T1',
      event_id: 'Ev1',
      event: {
        type: 'message',
        channel: 'D1',
        channel_type: 'im',
        user: 'U1',
        text: 'hello',
        ts: '1710000000.000000',
      },
    };

    await expect(
      handler.callDecode({ body: event } as Request, source),
    ).resolves.toEqual([]);

    await expect(
      handler.callDecode(
        {
          body: {
            ...event,
            api_app_id: 'A1',
            team_id: 'OTHER_TEAM',
          },
        } as Request,
        source,
      ),
    ).resolves.toEqual([]);
  });

  it('opens a DM for App Home block actions without a channel', async () => {
    const [event] = await handler.callDecode(
      {
        body: {
          type: 'block_actions',
          api_app_id: 'A1',
          team: { id: 'T1' },
          user: { id: 'U1', team_id: 'T1' },
          actions: [
            {
              type: 'button',
              value: 'MENU_START',
              text: { type: 'plain_text', text: 'Start' },
              action_ts: '1710000001.000000',
            },
          ],
        },
      } as Request,
      source,
    );

    expect((handler as any).slackApi.openConversation).toHaveBeenCalledWith(
      expect.objectContaining({ bot_token: 'xoxb-token' }),
      'U1',
    );
    expect(event.getChannelAttrs()).toMatchObject({
      conversationId: 'D-home',
      userId: 'U1',
    });
  });

  it('publishes the Home tab without emitting a chatbot event', async () => {
    const req = buildSignedRequest({
      type: 'event_callback',
      api_app_id: 'A1',
      team_id: 'T1',
      event_id: 'EvHome',
      event: {
        type: 'app_home_opened',
        user: 'U1',
        tab: 'home',
        event_ts: '1710000000.000000',
      },
    });
    const res = buildResponse();

    await handler.handle(req, res, source);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('');
    expect((handler as any).slackApi.publishHomeTab).toHaveBeenCalledWith(
      expect.objectContaining({ bot_token: 'xoxb-token' }),
      'U1',
      expect.objectContaining({ type: 'home' }),
    );
  });

  it('maps Slack user profile data with deterministic fallbacks', async () => {
    (handler as any).slackApi.getUserInfo = jest.fn(async () => ({
      id: 'U1',
      name: '',
      real_name: '',
      tz_offset: 3600,
      locale: 'en-US',
      profile: {},
    }));
    const [event] = await handler.callDecode(
      {
        body: {
          type: 'event_callback',
          api_app_id: 'A1',
          team_id: 'T1',
          event_id: 'EvProfile',
          event: {
            type: 'message',
            channel: 'D1',
            channel_type: 'im',
            user: 'U1',
            text: 'hello',
            ts: '1710000000.000000',
          },
        },
      } as Request,
      source,
    );
    event.setSourceContext(source.id, source.settings as Record<string, unknown>);

    await expect(handler.getSubscriberData(event as any)).resolves.toMatchObject({
      foreignId: 'U1',
      firstName: 'Slack',
      lastName: 'User',
      language: 'en',
      locale: 'en-US',
      timezone: 3600,
      source: 'source-1',
    });
  });
});
