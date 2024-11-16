/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { createHmac } from 'node:crypto';

import tsscmp from 'tsscmp';

const verifyErrorPrefix = 'Failed to verify authenticity';

export interface SlackRequestVerificationOptions {
  signingSecret: string;
  body: string;
  headers: {
    'x-slack-signature': string;
    'x-slack-request-timestamp': number;
  };
  nowMilliseconds?: number;
  requestTimestampMaxDeltaMin?: number;
}

/**
 * Verifies the signature of an incoming request from Slack.
 * If the request is invalid, this method throws an exception with the error details.
 */
export function verifySlackRequest(
  options: SlackRequestVerificationOptions,
): void {
  const requestTimestampSec = options.headers['x-slack-request-timestamp'];
  const signature = options.headers['x-slack-signature'];

  if (!requestTimestampSec || !signature) {
    throw new Error(`${verifyErrorPrefix}: missing signature headers`);
  }

  if (Number.isNaN(requestTimestampSec)) {
    throw new Error(
      `${verifyErrorPrefix}: header x-slack-request-timestamp did not have the expected type (${requestTimestampSec})`,
    );
  }

  // Calculate time-dependent values
  const nowMs = options.nowMilliseconds ?? Date.now();
  const maxStaleTimestampMinutes = options.requestTimestampMaxDeltaMin ?? 5; // Default to 5 minutes
  const staleTimestampThresholdSec =
    Math.floor(nowMs / 1000) - 60 * maxStaleTimestampMinutes;

  // Enforce verification rules

  // Rule 1: Check staleness
  if (requestTimestampSec < staleTimestampThresholdSec) {
    throw new Error(
      `${verifyErrorPrefix}: x-slack-request-timestamp must differ from system time by no more than ${maxStaleTimestampMinutes} minutes or request is stale`,
    );
  }

  // Rule 2: Check signature
  // Separate parts of signature
  const [signatureVersion, signatureHash] = signature.split('=');
  // Only handle known versions
  if (signatureVersion !== 'v0') {
    throw new Error(`${verifyErrorPrefix}: unknown signature version`);
  }
  // Compute our own signature hash
  const hmac = createHmac('sha256', options.signingSecret);
  hmac.update(`${signatureVersion}:${requestTimestampSec}:${options.body}`);
  const ourSignatureHash = hmac.digest('hex');
  if (!signatureHash || !tsscmp(signatureHash, ourSignatureHash)) {
    throw new Error(
      `${verifyErrorPrefix}: signature mismatch\nA request was made to the slack api with an invalid signature. This could be a malicious request. Please check the request's origin. If this is a legitimate request, please check the slack signing secret in Slack API settings.`,
    );
  }
}
