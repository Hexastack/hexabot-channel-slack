/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Readable, Stream } from 'stream';

import {
  ChannelCapabilities,
  ChannelHealthContext,
  ChannelInboundEvent,
  CredentialService,
  DEFAULT_CHANNEL_CAPABILITIES,
  ExtensionInject,
  HttpChannelHandler,
  LanguageService,
  MenuService,
  MenuTree,
  MenuType,
  MessageInboundEvent,
  SubscriberCreateDto,
} from '@hexabot-ai/api';
import type {
  ActionOptions,
  AttachmentRef,
  IntegrationHealthItem,
  Source,
  StdOutgoingMessageEnvelope,
} from '@hexabot-ai/types';
import { StdEventType } from '@hexabot-ai/types';
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Request, Response } from 'express';

import {
  SlackInboundEventDecoder,
  createSlackInboundEventDecoder,
} from './inbound';
import { SlackAttachmentMessageInboundEvent } from './inbound/events';
import {
  SlackOutboundMessageEncoder,
  createSlackOutboundMessageEncoder,
} from './outbound';
import { SlackApiService } from './services';
import {
  SLACK_CHANNEL_NAME,
  SLACK_CHANNEL_SOURCE_SETTINGS_SCHEMA,
  SLACK_CREDENTIAL_SETTING_KEYS,
  SLACK_REQUIRED_SETTING_KEYS,
  SlackChannelSettings,
  SlackCredentialSettingKey,
  SlackResolvedChannelSettings,
} from './settings.schema';
import { Slack } from './types';

type RawBodyRequest = Request & {
  rawBody?: string | Buffer;
};

const SIGNATURE_VERSION = 'v0';
const SIGNATURE_MAX_AGE_SECONDS = 60 * 5;
const SLACK_HOME_BLOCK_LIMIT = 100;

@Injectable()
export default class SlackChannelHandler extends HttpChannelHandler<
  typeof SLACK_CHANNEL_NAME
> {
  @Inject(LanguageService)
  private readonly languageService!: LanguageService;

  @Inject(MenuService)
  private readonly menuService!: MenuService;

  @Inject(ModuleRef)
  private readonly credentialsModuleRef!: ModuleRef;

  @ExtensionInject((name) => createSlackInboundEventDecoder(name))
  private inboundEventDecoder!: SlackInboundEventDecoder;

  @ExtensionInject((name) => createSlackOutboundMessageEncoder(name))
  private outboundMessageEncoder!: SlackOutboundMessageEncoder;

  @ExtensionInject(SlackApiService)
  private slackApi!: SlackApiService;

  private credentialService?: CredentialService;

  constructor() {
    super(SLACK_CHANNEL_NAME, SLACK_CHANNEL_SOURCE_SETTINGS_SCHEMA);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      ...DEFAULT_CHANNEL_CAPABILITIES,
      typingIndicator: false,
      maxTextLength: 40000,
    };
  }

  override async handle(
    req: Request,
    res: Response,
    source: Source,
    workflowId?: string,
  ): Promise<void> {
    if (req.method === 'GET') {
      return this.verifyWebhook(req, res, source);
    }

    try {
      await this.verifySignature(req, res, source);
    } catch (err) {
      this.logger.warn('Slack webhook signature verification failed', err);
      res.status(401).json({ error: 'Unauthorized' });

      return;
    }

    const payload = this.parseSlackPayload(req.body);

    if (payload.type === 'url_verification') {
      res.status(200).send(payload.challenge);

      return;
    }

    const settings = await this.parseSettingsWithCredentials(source.settings, [
      'bot_token',
    ]);

    if (!this.isSourcePayload(settings, payload)) {
      res.status(200).send('');

      return;
    }

    if (this.isAppHomeOpenedPayload(payload)) {
      res.status(200).send('');
      await this.handleAppHomeOpened(settings, payload);

      return;
    }

    let events: Array<
      ChannelInboundEvent<
        typeof SLACK_CHANNEL_NAME,
        Slack.IncomingPayload,
        Slack.ChannelAttrs
      >
    >;

    try {
      events = await this.decodeParsedPayload(payload, source, settings);
    } catch (err) {
      this.logger.warn('Failed to decode Slack webhook payload', err);
      res.status(400).json({ error: 'Bad Request' });

      return;
    }

    res.status(200).send('');

    for (const event of events) {
      event.setHandler(this);
      event.setSourceContext(source.id, source.settings);

      if (workflowId) {
        event.setWorkflowId(workflowId);
      }

      try {
        const subscriber = await this.resolveSubscriber(event);
        event.setInitiator(subscriber);

        if (event.getEventType() === StdEventType.message) {
          const messageEvent = event as MessageInboundEvent<
            typeof SLACK_CHANNEL_NAME
          >;
          await messageEvent.preprocess();
          await this.channelEventBus.emitMessage(messageEvent);
        } else {
          this.channelEventBus.emitStatusEvent(event);
        }
      } catch (err) {
        this.logger.error('Failed to process Slack webhook event', err);
      }
    }
  }

  protected async verifyWebhook(
    _req: Request,
    res: Response,
    _source: Source,
  ): Promise<void> {
    res.sendStatus(200);
  }

  protected async verifySignature(
    req: Request,
    _res: Response,
    source: Source,
  ): Promise<void> {
    const settings = await this.parseSettingsWithCredentials(source.settings, [
      'signing_secret',
    ]);

    if (!settings.signing_secret) {
      throw new Error('Slack signing secret is required');
    }

    const signature = this.getHeader(req, 'x-slack-signature');
    const timestamp = this.getHeader(req, 'x-slack-request-timestamp');

    if (!signature || !timestamp) {
      throw new Error('Missing Slack signature headers');
    }

    const requestTimestamp = Number.parseInt(timestamp, 10);

    if (!Number.isFinite(requestTimestamp)) {
      throw new Error('Invalid Slack request timestamp');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (Math.abs(nowSeconds - requestTimestamp) > SIGNATURE_MAX_AGE_SECONDS) {
      throw new Error('Stale Slack request timestamp');
    }

    const [version, digest] = signature.split('=');

    if (version !== SIGNATURE_VERSION || !digest) {
      throw new Error('Unsupported Slack signature version');
    }

    const rawBody = (req as RawBodyRequest).rawBody;

    if (rawBody === undefined) {
      throw new Error('Missing raw request body');
    }

    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = createHmac('sha256', settings.signing_secret)
      .update(`${SIGNATURE_VERSION}:${timestamp}:${body}`)
      .digest('hex');

    if (!this.safeCompareHex(digest, expected)) {
      throw new Error('Invalid Slack webhook signature');
    }
  }

  protected async decode(req: Request, source: Source) {
    const settings = await this.parseSettingsWithCredentials(source.settings, [
      'bot_token',
    ]);

    return await this.decodeParsedPayload(
      this.parseSlackPayload(req.body),
      source,
      settings,
    );
  }

  protected async doSendMessage(
    event: MessageInboundEvent<typeof SLACK_CHANNEL_NAME>,
    envelope: StdOutgoingMessageEnvelope,
    options: ActionOptions,
  ): Promise<{ mid: string }> {
    const settings = await this.parseSettingsWithCredentials(
      event.getSourceSettings(),
      ['bot_token'],
    );
    const sourceId = event.getSourceId();

    if (!sourceId) {
      throw new Error('Cannot send Slack message without source id');
    }

    const channelAttrs = event.getChannelAttrs<Slack.ChannelAttrs>();
    const channelId = channelAttrs.conversationId;

    if (!channelId) {
      throw new Error('Cannot send Slack message without conversation id');
    }

    const threadTs = this.resolveOutboundThread(settings, channelAttrs);
    const encoded = await this.outboundMessageEncoder.encode(envelope, {
      ...(options ?? {}),
      sourceId,
    });

    if (encoded.kind === 'message') {
      const response = await this.slackApi.postMessage(
        settings,
        {
          channel: channelId,
          text: encoded.text,
          blocks: encoded.blocks,
          thread_ts: threadTs,
          unfurl_links: false,
          unfurl_media: false,
        },
        settings.auto_join_public_channels,
      );

      return { mid: response.ts ?? randomUUID() };
    }

    const upload = await this.resolveAttachmentUpload(encoded.attachment);
    const uploadResponse = await this.slackApi.uploadFile(settings, {
      channel_id: channelId,
      file: upload.file,
      filename: upload.filename,
      initial_comment: encoded.initialComment,
      blocks: encoded.blocks,
      thread_ts: threadTs,
    });

    if (encoded.followUp) {
      await this.slackApi.postMessage(
        settings,
        {
          channel: channelId,
          text: encoded.followUp.text,
          blocks: encoded.followUp.blocks,
          thread_ts: threadTs,
          unfurl_links: false,
          unfurl_media: false,
        },
        settings.auto_join_public_channels,
      );
    }

    return { mid: uploadResponse.ts ?? uploadResponse.fileId ?? randomUUID() };
  }

  async getSubscriberData(
    event: MessageInboundEvent<typeof SLACK_CHANNEL_NAME>,
  ): Promise<SubscriberCreateDto> {
    const settings = await this.parseSettingsWithCredentials(
      event.getSourceSettings(),
      ['bot_token'],
    );
    const sourceId = event.getSourceId();
    const foreignId = event.getSenderForeignId();
    const userInfo = await this.getUserInfoSafe(settings, foreignId);
    const defaultLanguage = await this.getDefaultLanguageSafe();
    const profile = userInfo.profile ?? {};
    const firstName = this.firstNonEmpty(
      profile.first_name,
      profile.display_name,
      profile.real_name,
      userInfo.real_name,
      userInfo.name,
      'Slack',
    );
    const lastName = this.firstNonEmpty(
      profile.last_name,
      profile.display_name,
      profile.real_name,
      'User',
    );
    const locale = userInfo.locale ?? '';

    return {
      foreignId,
      firstName,
      lastName,
      assignedTo: null,
      assignedAt: null,
      lastvisit: new Date(),
      retainedFrom: new Date(),
      avatar: null,
      channel: event.getChannelData(),
      language: locale.slice(0, 2) || defaultLanguage,
      locale,
      timezone:
        typeof userInfo.tz_offset === 'number' &&
        Number.isFinite(userInfo.tz_offset)
          ? userInfo.tz_offset
          : 0,
      gender: profile.pronouns ?? null,
      country: null,
      labels: [],
      source: sourceId ?? '',
    };
  }

  async getSubscriberAvatar(
    event: MessageInboundEvent<typeof SLACK_CHANNEL_NAME>,
  ) {
    const settings = await this.parseSettingsWithCredentials(
      event.getSourceSettings(),
      ['bot_token'],
    );
    const userInfo = await this.getUserInfoSafe(
      settings,
      event.getSenderForeignId(),
    );
    const profile = userInfo.profile ?? {};
    const imageUrl =
      profile.image_original ??
      profile.image_1024 ??
      profile.image_512 ??
      profile.image_192 ??
      profile.image_72 ??
      profile.image_48;

    return imageUrl
      ? await this.slackApi.downloadUrl(imageUrl, 'slack-avatar')
      : undefined;
  }

  async getMessageAttachments(
    event: MessageInboundEvent<typeof SLACK_CHANNEL_NAME>,
  ) {
    if (!(event instanceof SlackAttachmentMessageInboundEvent)) {
      return [];
    }

    const settings = await this.parseSettingsWithCredentials(
      event.getSourceSettings(),
      ['bot_token'],
    );

    return await Promise.all(
      event
        .getRemoteFiles()
        .map((file) => this.slackApi.downloadSlackFile(settings, file)),
    );
  }

  async getIntegrationHealth(context: ChannelHealthContext) {
    const activeSources = context.sources.filter((source) => source.state);
    const missingSettings = (
      await Promise.all(
        activeSources.map(async (source) => {
          const settings = this.parseSettings(source.settings);

          if (!settings.app_id.trim() || !this.hasCredentialRefs(settings)) {
            return source;
          }

          const resolvedSettings = await this.resolveSettingsCredentials(
            settings,
            SLACK_CREDENTIAL_SETTING_KEYS,
          );

          return this.hasCredentialValues(resolvedSettings) ? null : source;
        }),
      )
    ).filter((source): source is Source => source !== null);

    if (activeSources.length === 0 || missingSettings.length === 0) {
      return {
        ...context.defaultHealth,
        details: {
          ...(context.defaultHealth.details ?? {}),
          requiredSettings: [...SLACK_REQUIRED_SETTING_KEYS],
        },
      } satisfies Partial<IntegrationHealthItem>;
    }

    return {
      status: 'unhealthy',
      reason: 'slack.missing_required_settings',
      message: `${missingSettings.length} active Slack source${
        missingSettings.length === 1 ? '' : 's'
      } missing required settings.`,
      details: {
        activeSources: activeSources.length,
        missingRequiredSettings: missingSettings.length,
        requiredSettings: [...SLACK_REQUIRED_SETTING_KEYS],
      },
    } satisfies Partial<IntegrationHealthItem>;
  }

  formatHomeTab(
    menu: MenuTree,
    settings: Pick<SlackResolvedChannelSettings, 'home_tab_content'>,
  ): Slack.HomeTabView {
    const content = this.parseHomeTabContent(settings.home_tab_content);
    const menuBlocks = this.formatMenuBlocks(menu);
    const blocks = [...content, ...menuBlocks].slice(0, SLACK_HOME_BLOCK_LIMIT);

    return {
      type: 'home',
      callback_id: 'hexabot_home',
      blocks,
    };
  }

  parseSlackPayload(body: unknown): Slack.IncomingPayload {
    const payload =
      body &&
      typeof body === 'object' &&
      'payload' in body &&
      typeof (body as { payload?: unknown }).payload === 'string'
        ? JSON.parse((body as { payload: string }).payload)
        : body;

    return Slack.incomingPayloadSchema.parse(payload);
  }

  private async decodeParsedPayload(
    payload: Slack.IncomingPayload,
    _source: Source,
    settings: SlackResolvedChannelSettings,
  ) {
    if (payload.type === 'url_verification') {
      return [];
    }

    if (!this.isSourcePayload(settings, payload)) {
      return [];
    }

    if (payload.type === 'event_callback') {
      if (payload.event.type === 'app_home_opened') {
        return [];
      }

      if (!payload.event.user) {
        return [];
      }

      const channelAttrs = this.createEventCallbackAttrs(payload);

      return this.inboundEventDecoder.createEvents(payload, channelAttrs);
    }

    if (payload.type === 'block_actions') {
      if (this.isIgnoredUrlAction(payload)) {
        return [];
      }

      const channelAttrs = await this.createBlockActionAttrs(settings, payload);

      return this.inboundEventDecoder.createEvents(payload, channelAttrs);
    }

    return [];
  }

  private createEventCallbackAttrs(
    payload: Slack.EventCallback,
  ): Slack.ChannelAttrs {
    const event = payload.event;
    const conversationId = event.channel ?? '';
    const messageTs = event.ts ?? event.event_ts;

    return {
      teamId: payload.team_id ?? '',
      enterpriseId: payload.enterprise_id ?? undefined,
      appId: payload.api_app_id,
      conversationId,
      conversationType:
        event.channel_type ?? this.resolveConversationType(conversationId),
      userId: event.user ?? '',
      messageTs,
      threadTs: event.thread_ts,
    };
  }

  private async createBlockActionAttrs(
    settings: SlackResolvedChannelSettings,
    payload: Slack.BlockAction,
  ): Promise<Slack.ChannelAttrs> {
    const conversationId =
      payload.channel?.id ??
      (await this.slackApi.openConversation(settings, payload.user.id));
    const messageTs = payload.message?.ts ?? payload.actions[0]?.action_ts;

    return {
      teamId: payload.team?.id ?? payload.user.team_id ?? '',
      enterpriseId: payload.enterprise?.id,
      appId: payload.api_app_id,
      conversationId,
      conversationType: this.resolveConversationType(conversationId),
      userId: payload.user.id,
      messageTs,
      threadTs: payload.message?.thread_ts,
    };
  }

  private isSourcePayload(
    settings: SlackChannelSettings,
    payload: Exclude<Slack.IncomingPayload, Slack.UrlVerification>,
  ): boolean {
    if (settings.app_id && payload.api_app_id !== settings.app_id) {
      this.logger.warn(
        `Ignoring Slack payload for unexpected app ${payload.api_app_id}`,
      );

      return false;
    }

    const teamId =
      payload.type === 'event_callback'
        ? payload.team_id
        : payload.team?.id ?? payload.user.team_id;

    if (settings.team_id && teamId && teamId !== settings.team_id) {
      this.logger.warn(`Ignoring Slack payload for unexpected team ${teamId}`);

      return false;
    }

    return true;
  }

  private isAppHomeOpenedPayload(
    payload: Slack.IncomingPayload,
  ): payload is Slack.EventCallback {
    return (
      payload.type === 'event_callback' && payload.event.type === 'app_home_opened'
    );
  }

  private async handleAppHomeOpened(
    settings: SlackResolvedChannelSettings,
    payload: Slack.EventCallback,
  ): Promise<void> {
    if (!settings.enable_home_tab || payload.event.tab !== 'home') {
      return;
    }

    const userId = payload.event.user;

    if (!userId) {
      return;
    }

    try {
      const menu = await this.menuService.getTree();
      await this.slackApi.publishHomeTab(
        settings,
        userId,
        this.formatHomeTab(menu, settings),
      );
    } catch (err) {
      this.logger.error('Failed to publish Slack Home tab', err);
    }
  }

  private formatMenuBlocks(menu: MenuTree): Slack.Block[] {
    if (menu.length === 0) {
      return [];
    }

    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: this.firstNonEmpty(this.safeTranslate('Menu'), 'Menu'),
          emoji: true,
        },
      },
      { type: 'divider' },
      ...this.formatMenuItems(menu),
    ];
  }

  private formatMenuItems(menu: MenuTree, level = 0): Slack.Block[] {
    const blocks: Slack.Block[] = [];

    for (const item of menu) {
      const prefix = level > 0 ? `${'  '.repeat(level)}- ` : '';
      const text = `${prefix}${item.title}`;

      if (item.type === MenuType.nested) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text,
          },
        });
        blocks.push(...this.formatMenuItems(item.call_to_actions ?? [], level + 1));

        continue;
      }

      const button =
        item.type === MenuType.web_url
          ? {
              type: 'button',
              text: {
                type: 'plain_text',
                text: this.safeTranslate('Visit'),
              },
              value: 'url',
              url: this.ensureHttpUrl(item.url),
            }
          : {
              type: 'button',
              text: {
                type: 'plain_text',
                text: this.safeTranslate('Select'),
              },
              value: item.payload,
            };

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
        accessory: button,
      });
    }

    return blocks;
  }

  private parseHomeTabContent(content: string): Slack.Block[] {
    try {
      const parsed = JSON.parse(content);

      if (
        Array.isArray(parsed) &&
        parsed.every((block) => block && typeof block === 'object')
      ) {
        return parsed as Slack.Block[];
      }
    } catch {
      return this.buildInvalidHomeTabContent(['Invalid JSON array']);
    }

    return this.buildInvalidHomeTabContent(['Home tab content must be an array']);
  }

  private buildInvalidHomeTabContent(errors: string[]): Slack.Block[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Invalid Slack Home tab content*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`\`\`${errors.join('\n')}\`\`\``,
        },
      },
      { type: 'divider' },
    ];
  }

  private isIgnoredUrlAction(payload: Slack.BlockAction): boolean {
    const action = payload.actions[0];

    return !!action?.url && (!action.value || action.value === 'url');
  }

  private resolveOutboundThread(
    settings: Pick<SlackResolvedChannelSettings, 'reply_in_threads'>,
    channelAttrs: Slack.ChannelAttrs,
  ): string | undefined {
    if (!settings.reply_in_threads || channelAttrs.conversationType === 'im') {
      return undefined;
    }

    return channelAttrs.threadTs ?? channelAttrs.messageTs;
  }

  private async resolveAttachmentUpload(
    attachmentRef: AttachmentRef,
  ): Promise<{
    file: Buffer | Stream | Readable;
    filename: string;
  }> {
    if ('id' in attachmentRef && attachmentRef.id) {
      const attachment = await this.attachmentService.findOne(attachmentRef.id);

      if (!attachment) {
        throw new Error(`Unable to find attachment ${attachmentRef.id}`);
      }

      const file = await this.attachmentService.readAsStream(attachment);

      if (!file) {
        throw new Error(`Unable to read attachment ${attachmentRef.id}`);
      }

      return {
        file,
        filename: attachment.name || attachmentRef.id,
      };
    }

    if ('url' in attachmentRef && attachmentRef.url) {
      const attachment = await this.slackApi.downloadUrl(attachmentRef.url);

      return {
        file: attachment.file as Buffer | Stream | Readable,
        filename:
          attachment.name ??
          this.resolveFilenameFromUrl(attachmentRef.url) ??
          'attachment',
      };
    }

    throw new Error('Unable to send Slack attachment: ref is missing');
  }

  private async getUserInfoSafe(
    settings: SlackResolvedChannelSettings,
    userId: string,
  ): Promise<Slack.UserInfo> {
    if (!settings.bot_token) {
      return {};
    }

    try {
      return await this.slackApi.getUserInfo(settings, userId);
    } catch (err) {
      this.logger.warn(`Unable to fetch Slack user profile ${userId}`, err);

      return {};
    }
  }

  private async getDefaultLanguageSafe(): Promise<string> {
    try {
      return (await this.languageService.getDefaultLanguage()).code;
    } catch {
      return '';
    }
  }

  private parseSettings(settings: unknown): SlackChannelSettings {
    return SLACK_CHANNEL_SOURCE_SETTINGS_SCHEMA.parse(settings ?? {});
  }

  private async parseSettingsWithCredentials(
    settings: unknown,
    credentialKeys: readonly SlackCredentialSettingKey[],
  ): Promise<SlackResolvedChannelSettings> {
    return await this.resolveSettingsCredentials(
      this.parseSettings(settings),
      credentialKeys,
    );
  }

  private async resolveSettingsCredentials(
    settings: SlackChannelSettings,
    credentialKeys: readonly SlackCredentialSettingKey[],
  ): Promise<SlackResolvedChannelSettings> {
    const resolvedSettings = { ...settings };

    await Promise.all(
      credentialKeys.map(async (key) => {
        resolvedSettings[key] = await this.resolveCredentialValue(settings[key]);
      }),
    );

    return resolvedSettings;
  }

  private async resolveCredentialValue(credentialId: string): Promise<string> {
    const id = credentialId.trim();

    if (!id) {
      return '';
    }

    const value = await this.getCredentialService().findOneValue(id);

    return value.trim();
  }

  private getCredentialService(): CredentialService {
    if (!this.credentialService) {
      this.credentialService = this.credentialsModuleRef.get(
        CredentialService,
        { strict: false },
      );
    }

    return this.credentialService;
  }

  private hasCredentialRefs(settings: SlackChannelSettings): boolean {
    return SLACK_CREDENTIAL_SETTING_KEYS.every((key) =>
      Boolean(settings[key].trim()),
    );
  }

  private hasCredentialValues(settings: SlackResolvedChannelSettings): boolean {
    return SLACK_CREDENTIAL_SETTING_KEYS.every((key) =>
      Boolean(settings[key].trim()),
    );
  }

  private getHeader(req: Request, key: string): string | null {
    const value = req.headers[key.toLowerCase()];

    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return typeof value === 'string' ? value : null;
  }

  private safeCompareHex(actual: string, expected: string): boolean {
    const actualBuffer = Uint8Array.from(Buffer.from(actual, 'hex'));
    const expectedBuffer = Uint8Array.from(Buffer.from(expected, 'hex'));

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private resolveConversationType(conversationId: string): Slack.ConversationType {
    if (conversationId.startsWith('D')) {
      return 'im';
    }

    if (conversationId.startsWith('G')) {
      return 'group';
    }

    return 'channel';
  }

  private resolveFilenameFromUrl(url: string): string | undefined {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').filter(Boolean).at(-1);

      return filename ? decodeURIComponent(filename) : undefined;
    } catch {
      return undefined;
    }
  }

  private firstNonEmpty(...values: Array<string | null | undefined>): string {
    return values.find((value) => !!value?.trim())?.trim() ?? '';
  }

  private safeTranslate(key: string): string {
    try {
      return this.firstNonEmpty((this as any).i18n?.t?.(key), key);
    } catch {
      return key;
    }
  }

  private ensureHttpUrl(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }
}
