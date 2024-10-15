import * as fs from 'fs';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import {
  AttachmentForeignKey,
  AttachmentPayload,
  WithUrl,
} from '@/chat/schemas/types/attachment';

import { SlackApi } from './slack-api';
import { Slack } from './types';

export default class SlackFileUploader {
  constructor(
    private slackApi: SlackApi,
    private attachement: AttachmentPayload<WithUrl<Attachment>>, // TODO: also take into consideration AttachmentForeignKey
    private channel: string,
  ) {}

  async upload() {
    const { upload_url, file_id } = await this.slackApi.getUploadURL(
      this.attachement.payload.url,
      this.attachement.payload.size,
    );
    await this.uploadToSlack(upload_url);
    await this.slackApi.CompleteUpload([{ id: file_id }], this.channel);
    return file_id;
  }

  private async uploadToSlack(uploadUrl: string) {
    const fileStream = 'aaa'; //fs.createReadStream(this.attachement.payload.url);
    await this.slackApi.uploadFile(uploadUrl, fileStream);
  }
}
