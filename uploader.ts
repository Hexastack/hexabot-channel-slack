/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { Attachment } from '@/attachment/schemas/attachment.schema';
import { AttachmentService } from '@/attachment/services/attachment.service';
import { AttachmentPayload, WithUrl } from '@/chat/schemas/types/attachment';

import { SlackApi } from './slack-api';

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
    const files = await this.slackApi.CompleteUpload(
      [{ id: file_id }],
      this.channel,
    );
    return files;
  }

  private async uploadToSlack(uploadUrl: string) {
    const fileStream = await this.attachmentService.downloadAsBytes(
      this.attachment.payload,
    );
    await this.slackApi.uploadFile(uploadUrl, fileStream);
  }
}
