import * as fs from 'fs';

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { AttachmentService } from '@/attachment/services/attachment.service';
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
    private attachment: AttachmentPayload<WithUrl<Attachment>>, // TODO: also take into consideration AttachmentForeignKey
    private channel: string,
    private attachmentService: AttachmentService,
  ) {}

  async upload() {
    const { upload_url, file_id } = await this.slackApi.getUploadURL(
      this.attachment.payload.url,
      this.attachment.payload.size,
    );
    await this.uploadToSlack(upload_url);
    await this.slackApi.CompleteUpload([{ id: file_id }], this.channel);
    return file_id;
  }

  private async uploadToSlack(uploadUrl: string) {
    const fileStream = await this.attachmentService.downloadAsBytes(
      this.attachment.payload,
    ); //fs.createReadStream(this.attachement.pa  yload.url);
    debugger;
    await this.slackApi.uploadFile(uploadUrl, fileStream);
  }
}
