/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

export namespace Slack {
  export type ChannelData = {
    channel_id: string;
  };

  export enum SlackType { //TODO: to update https://api.slack.com/apis/events-api#event_type_structure
    app_home_opened = 'app_home_opened',
    payload = 'payload',
    incoming_message = 'message',
    file_shared = 'file_shared',
    file_created = 'file_created',
    interactive_message = 'interactive_message', //payload type
    shortcut = 'shortcut', //payload type
    message_action = 'message_action', //payload type
    block_actions = 'block_actions', //payload type
  }

  export enum EventType {
    event__callback = 'event_callback',
    url_verification = 'url_verification',
  }

  export enum ApiEndpoint {
    usersInfo = 'users.info',
    chatPostMessage = 'chat.postMessage',
    getUploadURL = 'files.getUploadURLExternal',
    completeUpload = 'files.completeUploadExternal',
  }

  export enum CallbackId {
    quick_replies = 'quick_replies',
    buttons = 'buttons',
  }
  /**
   *  User Information
   */

  export interface UsersInfoResponse {
    ok?: boolean;
    user?: User;
    error?: string;
    needed?: string;
    provided?: string;
  }

  export interface User {
    id?: string;
    team_id?: string;
    name?: string;
    deleted?: boolean;
    color?: string;
    real_name?: string;
    tz?: string;
    tz_label?: string;
    tz_offset?: number;
    profile?: Profile;
    is_admin?: boolean;
    is_owner?: boolean;
    is_primary_owner?: boolean;
    is_restricted?: boolean;
    is_ultra_restricted?: boolean;
    is_bot?: boolean;
    is_app_user?: boolean;
    updated?: number;
    has_2fa?: boolean;
    locale?: string;
  }

  export interface Profile {
    title?: string;
    phone?: string;
    skype?: string;
    real_name?: string;
    real_name_normalized?: string;
    display_name?: string;
    display_name_normalized?: string;
    status_text?: string;
    status_emoji?: string;
    status_expiration?: number;
    avatar_hash?: string;
    image_original?: string;
    is_custom_image?: boolean;
    email?: string;
    first_name?: string;
    last_name?: string;
    image_24?: string;
    image_32?: string;
    image_48?: string;
    image_72?: string;
    image_192?: string;
    image_512?: string;
    image_1024?: string;
    status_text_canonical?: string;
    team?: string;
    api_app_id?: string;
    always_active?: boolean;
    bot_id?: string;
  }
  // IncomingEvents could be payload or command or event (message or attachment or ...):

  export interface AuthorizationObject {
    enterprise_id?: string;
    team_id?: string;
    user_id?: string;
    is_bot: boolean;
  }

  export interface IncomingEvent {
    // payload?: string;   //JSON.parse(payload): IncomingPayload for payload event
    type?: EventType;
    token?: string;
    team_id?: string;
    api_app_id?: string; //TODO: validate api_app_id along with token: https://api.slack.com/apis/events-api#the-events-api__receiving-events__callback-field-overview
    event?: AppHomeOpened | IncomingMessage | IncomingAttachement;
    eventContext?: string;
    event_id?: string;
    event_time?: number;
    authorizations?: AuthorizationObject[]; //TODO: to verify
    is_ext_shared_channel?: boolean;
    context_team_id?: string; //TODO: to verify (added by mtbh)
    context_enterprise_id?: string; //TODO: to verify (added by mtbh)
  }

  export interface ElementObject {
    type: string;
    text?: string;
    name?: string;
  }

  export interface BlockObject {
    type: string;
    block_id: string;
    elements: [
      {
        type: string;
        elements: ElementObject[];
      },
    ];
  }

  export interface Event {
    api_app_id: string; //  TODO: to verify that it's there for all events
    type: SlackType;
    event_ts: string;
    user?: string;
    ts?: string;
    app_id?: string; // only for echo messages

    client_msg_id?: string;

    response_url?: string;
    original_message?: Event;

    mid?: string;
    bot_id?: string;
    subtype?: string;
    actions?: Payload[]; //for payload events
    text?: string; // mtbh: in INcomingAttachement??
    files?: Array<File>; // mtbh: in INcomingAttachement??

    team?: string;
    blocks?: BlockObject[];
    channel?: string;
    attachments?: MessageAttachment[];
    channel_type?: 'im' | 'mpim' | 'private' | 'public' | 'channel';
  }

  export enum SubtypeEvent { //TODmtbh: in INcomingAttachement??O: add more subtypes (like "message_replied")
    echo_message = 'bot_message',
    file_share = 'file_share',
    message_changed = 'message_changed', //payload buttons
    message_deleted = 'message_deleted',
  }

  export interface AppHomeOpened extends Event {
    type: SlackType.app_home_opened;
    tab: string;
  }

  export interface IncomingMessage extends Event {
    type: SlackType.incoming_message;
    client_msg_id: string;
    blocks: BlockObject[]; //TODO: redundant, is this in IncomingMessage or Event?
  }

  export interface IncomingAttachement extends Event {
    type: SlackType.incoming_message;
    files: Array<File>;
    upload?: boolean;
    display_as_bot?: boolean;
    subtype: Slack.SubtypeEvent.file_share;
  }

  export interface ImageFile extends File {
    original_h: number;
    original_w: number;
    thumb_tiny: string;
    [key: `thumb_${number}`]: string | number;
    [key: `thumb_${number}_w`]: number;
    [key: `thumb_${number}_h`]: number;
  }

  export interface TextFile extends File {
    preview: string;
    preview_highlight: string;
    preview_is_truncated: boolean;
    lines: number;
    lines_more: number;
  }

  export interface File {
    created: number;
    display_as_bot?: boolean;
    edit_link?: string;
    editable?: boolean;
    external_type?: string;
    file_access: string;
    file_type: string;
    has_rich_preview?: boolean;
    id: string;
    is_external?: boolean;
    is_public?: boolean;

    mimetype: string;
    mode: string;
    name: string;

    permalink: string;
    permalink_public: string;
    pretty_type: string;

    public_url_shared?: boolean;
    size: number;
    timestamp: number;
    title: string;
    url_private: string;
    url_private_download: string;
    user: string;
    userTeam: string;
    username: string;
  }

  export interface Payload {
    name?: string;
    type: string;
    value: string;
    action_id?: string;
    block_id?: string;
    text?: {
      type: string;
      text: string;
      emoji: boolean;
    };
    action_ts?: string;
  }

  export interface IncomingPayload {
    api_app_id: string;
    type: SlackType.interactive_message | SlackType.block_actions;
    actions: Payload[];
    callback_id: string;
    team: {
      id: string;
      domain: string;
    };
    channel: {
      id: string;
      name: string;
    };
    user: {
      id: string;
      name: string;
      username: string;
      team_id: string;
    };
    message_ts: string;
    token: string;
    is_app_unfurl: boolean;
    original_message: Event;
    response_url: string;
    action_ts?: string;
    trigger_id: string;
    attachment_id?: string;
  }

  export interface PayloadEvent {
    payload: string;
  }

  export interface CommandEvent {
    channel_id: string;
    channel_name?: string;
    command: string;
    response_url?: string;
    team_domain?: string;
    team_id?: string;
    text: string;
    token: string;
    trigger_id?: string;
    user_id: string;
    user_name?: string;
  }

  export type BodyEvent = IncomingEvent | PayloadEvent | CommandEvent;

  export interface OutgoingMessage {
    channel?: string;
    text?: string;
    attachments?: MessageAttachment[];
    blocks?: KnownBlock[];
    file?: UploadFileObject;
    initial_comment?: string; //a message before the file
    title?: string;
  }

  export interface AttachmentMessage extends OutgoingMessage {
    attachments: MessageAttachment[];
  }

  export interface TextMessage extends OutgoingMessage {
    text: string;
  }

  export interface BlockMessage extends OutgoingMessage {
    blocks: Array<KnownBlock>;
  }

  export interface FileMessage extends OutgoingMessage {
    channels?: string;
    file?: UploadFileObject;
    filename?: string;
    filetype?: string;
    content?: any;
    initial_comment?: string; //a message before the file
    title?: string; //title or filename
  }

  export type OutgoingMessageData =
    | TextMessage
    | AttachmentMessage
    | BlockMessage
    | FileMessage;

  export interface ImageElement {
    type: 'image';
    image_url: string;
    alt_text: string;
  }

  export interface PlainTextElement {
    type: 'plain_text';
    text: string;
    emoji?: boolean;
  }

  export interface MrkdwnElement {
    type: 'mrkdwn';
    text: string;
    verbatim?: boolean;
  }

  export interface Option {
    text: PlainTextElement | MrkdwnElement;
    value?: string;
    url?: string;
    description?: PlainTextElement;
  }

  export interface Confirm {
    title?: PlainTextElement;
    text: PlainTextElement | MrkdwnElement;
    confirm?: PlainTextElement;
    deny?: PlainTextElement;
    style?: 'primary' | 'danger';
  }

  /*
   * Action Types
   */

  export interface Action {
    type: string;
    action_id?: string;
  }

  export interface Button extends Action {
    type: 'button';
    name?: string;
    text: PlainTextElement | string;
    value?: string;
    url?: string;
    style?: 'default' | 'danger' | 'primary';
    confirm?: Confirmation;
  }

  /*/ UploadFile Object */

  export interface UploadFileObject {
    value: any;
    options?: {
      filename?: string;
      filetype?: any;
    };
  }

  /*
   * Block Types
   */

  export type KnownBlock =
    | ContextBlock
    | ImageBlock
    | ActionsBlock
    | DividerBlock
    | SectionBlock
    | FileBlock
    | HeaderBlock
    | InputBlock
    | RichTextBlock;
  //| VideoBlock

  export interface Block {
    type: string;
    block_id?: string;
  }

  export interface ContextBlock extends Block {
    type: 'context';
    elements: (PlainTextElement | MrkdwnElement | ImageElement)[];
  }

  export interface HeaderBlock extends Block {
    type: 'header';
    text: PlainTextElement;
  }

  export type ImageBlock = ImageBlockWithUrl | ImageBlockWithSlackFile;

  export interface ImageBlockBase extends Block {
    type: 'image';
    alt_text: string;
    title?: PlainTextElement;
  }

  export interface ImageBlockWithUrl extends ImageBlockBase {
    image_url: string;
    slack_file?: never;
  }

  export interface ImageBlockWithSlackFile extends ImageBlockBase {
    image_url?: never;
    slack_file: SlackFile;
  }

  export interface ActionsBlock extends Block {
    type: 'actions';
    elements: (Button | Action)[];
  }

  export interface DividerBlock extends Block {
    type: 'divider';
  }

  export interface SectionBlock extends Block {
    type: 'section';
    text?: PlainTextElement | MrkdwnElement; // either this or fields must be defined
    fields?: (PlainTextElement | MrkdwnElement)[]; // either this or text must be defined
    accessory?: Button | Action | ImageElement;
    expand?: boolean;
  }

  export interface FileBlock extends Block {
    type: 'file';
    source: string; // 'remote'
    external_id: string;
  }

  export interface InputBlock extends Block {
    type: 'input';
    label: PlainTextElement;
    element: any; //TODO: block element https://api.slack.com/reference/block-kit/block-elements
    dispatch_action?: boolean;
    hint?: PlainTextElement;
    optional?: boolean;
  }

  export interface RichTextBlock extends Block {
    type: 'rich_text';
    elements: any[]; //TODO: replace any with rich text elements: https://api.slack.com/reference/block-kit/blocks#rich_fields
  }

  export type SlackFile = { id: string } | { url: string };

  export interface MessageAttachment {
    blocks?: (KnownBlock | Block)[];
    id?: string;
    fallback?: string; // either this or text must be defined
    color?: 'good' | 'warning' | 'danger' | string;
    pretext?: string;
    attachment_type?: string | 'default';
    author_name?: string;
    author_link?: string; // author_name must be present
    author_icon?: string; // author_name must be present
    title?: string;
    title_link?: string; // title must be present
    text?: string; // either this or fallback must be defined
    fields?: {
      title: string;
      value: string;
      short?: boolean;
    }[];
    image_url?: string;
    thumb_url?: string;
    footer?: string;
    footer_icon?: string; // footer must be present
    ts?: string;
    actions?: (AttachmentAction | Button)[] | boolean;
    callback_id?: string;
    mrkdwn_in?: ('pretext' | 'text' | 'fields')[];
  }

  export interface AttachmentAction {
    id?: string;
    confirm?: Confirmation;
    data_source?:
      | 'static'
      | 'channels'
      | 'conversations'
      | 'users'
      | 'external';
    min_query_length?: number;
    name?: string;
    options?: OptionField[];
    option_groups?: {
      text: string;
      options: OptionField[];
    }[];
    selected_options?: OptionField[];
    style?: 'default' | 'primary' | 'danger';
    text: string;
    type: 'button' | 'select';
    value?: string;
    url?: string;
  }

  export interface OptionField {
    description?: string;
    text: string;
    value: string;
  }

  export interface Confirmation {
    dismiss_text?: string;
    ok_text?: string;
    text: string;
    title?: string;
  }

  export type RequestBody = OutgoingMessageData | Profile | Action | {};

  export type UploadUrlData = {
    ok: boolean;
    upload_url: string;
    file_id: string;
  };
}
