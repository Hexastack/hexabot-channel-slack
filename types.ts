/*
 * Copyright © 2024 Hexastack. All rights reserved.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3) with the following additional terms:
 * 1. The name "Hexabot" is a trademark of Hexastack. You may not use this name in derivative works without express written permission.
 * 2. All derivative works must include clear attribution to the original creator and software, Hexastack and Hexabot, in a prominent location (e.g., in the software's "About" section, documentation, and README file).
 */

import { AppMentionEvent, Block, Confirmation, GenericMessageEvent, KnownBlock, MessageAttachment, Option, PlainTextElement, RichTextBlock, SlackEvent, View } from "@slack/types";

export namespace Slack {
    /****************************/
    /* API RELATED TYPES        */
    /****************************/
    interface Text {
        /**
         * @description Text of the message. If used in conjunction with `blocks` or `attachments`, `text` will be used
         * as fallback text for notifications only.
         */
        text: string;
    }
    export interface Blocks extends Partial<Text> {
        /**
         * @description An array of structured Blocks.
         * @see {@link https://api.slack.com/reference/block-kit/blocks Blocks reference}.
         */
        blocks: (KnownBlock | Block)[];
    }
    export interface Attachments extends Partial<Text> {
        /**
         * @description An array of structured attachments.
         * @see {@link https://api.slack.com/messaging/composing/layouts#attachments Adding secondary attachments}.
         */
        attachments: MessageAttachment[];
    }
    export type OutgoingMessage = (Text | Blocks | Attachments);

    export interface RequestVerificationOptions {
      signingSecret: string;
      body: Buffer;
      headers: {
        'x-slack-signature': string | string[];
        'x-slack-request-timestamp': string | string[];
      };
      nowMilliseconds?: number;
      requestTimestampMaxDeltaMin?: number;
    }
    
    export interface URLVerificationEvent {
        token: string;
        challenge: string;
        type: 'url_verification';
    }

    export type HomeTabView = {
        type: 'home';
        blocks: KnownBlock[];
        private_metadata?: string;
        callback_id?: string;
        external_id?: string;
    };

    export type ModalView = {
        type: 'modal';
        title: PlainTextElement;
        blocks: KnownBlock[];
        close: PlainTextElement;
        submit: PlainTextElement;
        private_metadata?: string;
        callback_id?: string;
        clear_on_close?: boolean;
        notify_on_close?: boolean;
        external_id?: string;
        submit_disabled?: boolean;
    };

    /****************************/
    /* EVENT RELATED TYPES      */
    /****************************/

    interface Authorization {
        enterprise_id: string | null;
        team_id: string | null;
        user_id: string;
        is_bot: boolean;
        is_enterprise_install?: boolean;
    }
    export type ChannelTypes = 'channel' | 'group' | 'im' | 'mpim' | 'app_home';

    export type SupportedEvent = AppMentionEvent | GenericMessageEvent // | BotMessageEvent | MeMessageEvent | MessageChangedEvent | MessageRepliedEvent

    export interface EventCallback<T extends SlackEvent = SupportedEvent> {
        token: string;
        team_id: string;
        enterprise_id?: string;
        api_app_id: string;
        event: T;
        type: 'event_callback';
        event_id: string;
        event_time: number;
        is_ext_shared_channel?: boolean;
        authorizations?: Authorization[];
    }

    export type IncomingEvent = BlockAction<ButtonAction> | EventCallback<SupportedEvent>;

    /***********************************************************************************************/
    /* BLOCK AND VIEWS RELATED TYPES                                                                         */
    /***********************************************************************************************/

    /**
     * The following Slack Typescript type definitions have been copied from Bolt-JS (<3 thank you)
     * We are currently not using them all but just in case we would like to expand on them.
     * 
     * The MIT License (MIT)
     * Copyright (c) 2016-2018 Robots & Pencils
     * Copyright (c) 2019- Slack Technologies, LLC
     */

    /**
     * All known actions from in Slack's interactive elements
     *
     * This is a discriminated union. The discriminant is the `type` property.
     */
    export type BlockElementAction =
        | ButtonAction
        | UsersSelectAction
        | MultiUsersSelectAction
        | StaticSelectAction
        | MultiStaticSelectAction
        | ConversationsSelectAction
        | MultiConversationsSelectAction
        | ChannelsSelectAction
        | MultiChannelsSelectAction
        | ExternalSelectAction
        | MultiExternalSelectAction
        | OverflowAction
        | DatepickerAction
        | TimepickerAction
        | RadioButtonsAction
        | CheckboxesAction
        | PlainTextInputAction
        | RichTextInputAction;

    /**
    * Any action from Slack's interactive elements
    *
    * This type is used to represent actions that aren't known ahead of time. Each of the known element actions also
    * implement this interface.
    */
    export interface BasicElementAction<T extends string = string> {
        type: T;
        // block_id: string;
        action_id?: string;
        action_ts?: string;
    }

    /**
    * An action from a button element
    */
    export interface ButtonAction extends BasicElementAction<'button'> {
        value?: string;
        text: PlainTextElement;
        url?: string;
        confirm?: Confirmation;
    }

    /**
    * An action from a select menu with static options
    */
    export interface StaticSelectAction extends BasicElementAction<'static_select'> {
        selected_option: {
            text: PlainTextElement;
            value: string;
        };
        initial_option?: Option;
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a multi select menu with static options
    */
    export interface MultiStaticSelectAction extends BasicElementAction<'multi_static_select'> {
        selected_options: {
            text: PlainTextElement;
            value: string;
        }[];
        initial_options?: Option[];
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a select menu with user list
    */
    export interface UsersSelectAction extends BasicElementAction<'users_select'> {
        selected_user: string;
        initial_user?: string;
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a multi select menu with user list
    */
    export interface MultiUsersSelectAction extends BasicElementAction<'multi_users_select'> {
        selected_users: string[];
        initial_users?: string[];
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a select menu with conversations list
    */
    export interface ConversationsSelectAction extends BasicElementAction<'conversations_select'> {
        selected_conversation: string;
        initial_conversation?: string;
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a multi select menu with conversations list
    */
    export interface MultiConversationsSelectAction extends BasicElementAction<'multi_conversations_select'> {
        selected_conversations: string[];
        initial_conversations?: string[];
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a select menu with channels list
    */
    export interface ChannelsSelectAction extends BasicElementAction<'channels_select'> {
        selected_channel: string;
        initial_channel?: string;
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a multi select menu with channels list
    */
    export interface MultiChannelsSelectAction extends BasicElementAction<'multi_channels_select'> {
        selected_channels: string[];
        initial_channels?: string[];
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a select menu with external data source
    */
    export interface ExternalSelectAction extends BasicElementAction<'external_select'> {
        selected_option?: Option;
        initial_option?: Option;
        placeholder?: PlainTextElement;
        min_query_length?: number;
        confirm?: Confirmation;
    }

    /**
    * An action from a multi select menu with external data source
    */
    export interface MultiExternalSelectAction extends BasicElementAction<'multi_external_select'> {
        selected_options?: Option[];
        initial_options?: Option[];
        placeholder?: PlainTextElement;
        min_query_length?: number;
        confirm?: Confirmation;
    }

    /**
    * An action from an overflow menu element
    */
    export interface OverflowAction extends BasicElementAction<'overflow'> {
        selected_option: {
            text: PlainTextElement;
            value: string;
        };
        confirm?: Confirmation;
    }

    /**
    * An action from a date picker element
    */
    export interface DatepickerAction extends BasicElementAction<'datepicker'> {
        selected_date: string | null;
        initial_date?: string;
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a time picker element
    */
    export interface TimepickerAction extends BasicElementAction<'timepicker'> {
        selected_time: string | null;
        initial_time?: string;
        placeholder?: PlainTextElement;
        confirm?: Confirmation;
    }

    /**
    * An action from a radio button element
    */
    export interface RadioButtonsAction extends BasicElementAction<'radio_buttons'> {
        selected_option: Option | null;
        initial_option?: Option;
        confirm?: Confirmation;
    }

    /**
    * An action from a checkboxes element
    */
    export interface CheckboxesAction extends BasicElementAction<'checkboxes'> {
        selected_options: Option[];
        initial_options?: Option[];
        confirm?: Confirmation;
    }

    /**
    * An action from a plain_text_input element (must use dispatch_action: true)
    */
    export interface PlainTextInputAction extends BasicElementAction<'plain_text_input'> {
        value: string;
    }

    /**
    * An action from a rich_text_input element (must use dispatch_action: true)
    */
    export interface RichTextInputAction extends BasicElementAction<'rich_text_input'> {
        rich_text_value: RichTextBlock;
    }

    /**
    * A Slack Block Kit element action wrapped in the standard metadata.
    *
    * This describes the entire JSON-encoded body of a request from Slack's Block Kit interactive components.
    */
    export interface BlockAction<ElementAction extends BasicElementAction = BlockElementAction> {
        type: 'block_actions';
        actions: ElementAction[];
        team: {
            id: string;
            domain: string;
            enterprise_id?: string; // undocumented
            enterprise_name?: string; // undocumented
        } | null;
        user: {
            id: string;
            /**
             * name will be present if the block_action originates from the Home tab
             */
            name?: string;
            username: string;
            team_id?: string;
        };
        channel?: {
            id: string;
            name: string;
        };
        // TODO: breaking change: this should not be optional, but should be conditionally tacked on based on the specific block_action subtype
        message?: {
            type: 'message';
            user?: string; // undocumented that this is optional, it won't be there for bot messages
            ts: string;
            text?: string; // undocumented that this is optional, but how could it exist on block kit based messages?
            // biome-ignore lint/suspicious/noExplicitAny: TODO: poorly typed message here
            [key: string]: any;
        };
        view?: ViewOutput;
        state?: {
            values: {
                [blockId: string]: {
                    [actionId: string]: ViewStateValue;
                };
            };
        };
        token: string;
        response_url: string;
        trigger_id: string;
        api_app_id: string;

        // TODO: we'll need to fill this out a little more carefully in the future, possibly using a generic parameter
        container: Record<string, any>;

        // biome-ignore lint/suspicious/noExplicitAny: TODO: this appears in the block_suggestions schema, but we're not sure when its present or what its type would be
        app_unfurl?: any;

        // exists for enterprise installs
        is_enterprise_install?: boolean;
        enterprise?: {
            id: string;
            name: string;
        };
    }

    /*
    * Aliases - these types help make common usages shorter and less intimidating.
    */
    export type BlockButtonAction = BlockAction<ButtonAction>;
    export type BlockStaticSelectAction = BlockAction<StaticSelectAction>;
    export type BlockUsersSelectAction = BlockAction<UsersSelectAction>;
    export type BlockConversationsSelectAction = BlockAction<ConversationsSelectAction>;
    export type BlockChannelsSelectAction = BlockAction<ChannelsSelectAction>;
    export type BlockExternalSelectAction = BlockAction<ExternalSelectAction>;
    export type BlockOverflowAction = BlockAction<OverflowAction>;
    export type BlockDatepickerAction = BlockAction<DatepickerAction>;
    export type BlockTimepickerAction = BlockAction<TimepickerAction>;
    export type BlockRadioButtonsAction = BlockAction<RadioButtonsAction>;
    export type BlockCheckboxesAction = BlockAction<CheckboxesAction>;
    export type BlockPlainTextInputAction = BlockAction<PlainTextInputAction>;

    /**
 * Known view action types
 */
    export type SlackViewAction =
        | ViewSubmitAction
        | ViewClosedAction
        | ViewWorkflowStepSubmitAction // TODO: remove workflow step stuff in bolt v5
        | ViewWorkflowStepClosedAction;
    // <ViewAction extends SlackViewAction = ViewSubmitAction>
    // TODO: add a type parameter here, just like the other constraint interfaces have.
    export interface ViewConstraints {
        callback_id?: string | RegExp;
        type?: 'view_closed' | 'view_submission';
    }

    export interface ViewResponseUrl {
        block_id: string;
        action_id: string;
        channel_id: string;
        response_url: string;
    }

    // TODO: "Action" naming here is confusing. this is a view submisson event. already exists in @slack/types
    /**
    * A Slack view_submission event wrapped in the standard metadata.
    *
    * This describes the entire JSON-encoded body of a view_submission event.
    */
    export interface ViewSubmitAction {
        type: 'view_submission';
        team: {
            id: string;
            domain: string;
            enterprise_id?: string; // undocumented
            enterprise_name?: string; // undocumented
        } | null;
        user: {
            id: string;
            name: string;
            team_id?: string; // undocumented
        };
        view: ViewOutput;
        api_app_id: string;
        token: string;
        trigger_id: string; // undocumented
        // exists for enterprise installs
        is_enterprise_install?: boolean;
        enterprise?: {
            id: string;
            name: string;
        };
        response_urls?: ViewResponseUrl[];
    }

    /**
    * A Slack view_closed event wrapped in the standard metadata.
    *
    * This describes the entire JSON-encoded body of a view_closed event.
    */
    export interface ViewClosedAction {
        type: 'view_closed';
        team: {
            id: string;
            domain: string;
            enterprise_id?: string; // undocumented
            enterprise_name?: string; // undocumented
        } | null;
        user: {
            id: string;
            name: string;
            team_id?: string; // undocumented
        };
        view: ViewOutput;
        api_app_id: string;
        token: string;
        is_cleared: boolean;
        // exists for enterprise installs
        is_enterprise_install?: boolean;
        enterprise?: {
            id: string;
            name: string;
        };
    }

    /**
    * A Slack view_submission step from app event
    *
    * This describes the additional JSON-encoded body details for a step's view_submission event
    * @deprecated Steps from Apps are no longer supported and support for them will be removed in the next major bolt-js
    * version.
    */
    export interface ViewWorkflowStepSubmitAction extends ViewSubmitAction {
        trigger_id: string;
        response_urls?: ViewResponseUrl[];
        workflow_step: {
            workflow_step_edit_id: string;
            workflow_id: string;
            step_id: string;
        };
    }

    /**
    * A Slack view_closed step from app event
    *
    * This describes the additional JSON-encoded body details for a step's view_closed event
    * @deprecated Steps from Apps are no longer supported and support for them will be removed in the next major bolt-js
    * version.
    */
    export interface ViewWorkflowStepClosedAction extends ViewClosedAction {
        workflow_step: {
            workflow_step_edit_id: string;
            workflow_id: string;
            step_id: string;
        };
    }

    export interface ViewStateSelectedOption {
        text: PlainTextElement;
        value: string;
    }

    // TODO: this should probably exist in @slack/types
    export interface UploadedFile {
        id: string;
        created: number;
        timestamp: number;
        name: string;
        title: string;
        filetype: string;
        mimetype: string;
        permalink: string;
        url_private: string;
        url_private_download: string;
        user: string;
        user_team: string;
        username?: string;
        access?: string;
        alt_txt?: string;
        app_id?: string;
        app_name?: string;
        bot_id?: string;
        channel_actions_count?: number;
        channel_actions_ts?: string;
        channels?: string[];
        comments_count?: number;
        converted_pdf?: string;
        deanimate?: string;
        deanimate_gif?: string;
        display_as_bot?: boolean;
        duration_ms?: number;
        edit_link?: string;
        editable?: boolean;
        editor?: string;
        external_id?: string;
        external_type?: string;
        external_url?: string;
        file_access?: string;
        groups?: string[];
        has_more?: boolean;
        has_more_shares?: boolean;
        has_rich_preview?: boolean;
        hls?: string;
        hls_embed?: string;
        image_exif_rotation?: number;
        ims?: string[];
        is_channel_space?: boolean;
        is_external?: boolean;
        is_public?: boolean;
        is_starred?: boolean;
        last_editor?: string;
        last_read?: number;
        lines?: number;
        lines_more?: number;
        linked_channel_id?: string;
        media_display_type?: string;
        mode?: string;
        mp4?: string;
        mp4_low?: string;
        non_owner_editable?: boolean;
        num_stars?: number;
        org_or_workspace_access?: string;
        original_attachment_count?: number;
        original_h?: string;
        original_w?: string;
        permalink_public?: string;
        pinned_to?: string[];
        pjpeg?: string;
        plain_text?: string;
        pretty_type?: string;
        preview?: string;
        preview_highlight?: string;
        preview_is_truncated?: boolean;
        preview_plain_text?: string;
        private_channels_with_file_access_count?: number;
        public_url_shared?: boolean;
        simplified_html?: string;
        size?: number;
        source_team?: string;
        subject?: string;
        subtype?: string;
        thumb_1024?: string;
        thumb_1024_gif?: string;
        thumb_1024_h?: string;
        thumb_1024_w?: string;
        thumb_160?: string;
        thumb_160_gif?: string;
        thumb_160_h?: string;
        thumb_160_w?: string;
        thumb_360?: string;
        thumb_360_gif?: string;
        thumb_360_h?: string;
        thumb_360_w?: string;
        thumb_480?: string;
        thumb_480_gif?: string;
        thumb_480_h?: string;
        thumb_480_w?: string;
        thumb_64?: string;
        thumb_64_gif?: string;
        thumb_64_h?: string;
        thumb_64_w?: string;
        thumb_720?: string;
        thumb_720_gif?: string;
        thumb_720_h?: string;
        thumb_720_w?: string;
        thumb_80?: string;
        thumb_800?: string;
        thumb_800_gif?: string;
        thumb_800_h?: string;
        thumb_800_w?: string;
        thumb_80_gif?: string;
        thumb_80_h?: string;
        thumb_80_w?: string;
        thumb_960?: string;
        thumb_960_gif?: string;
        thumb_960_h?: string;
        thumb_960_w?: string;
        thumb_gif?: string;
        thumb_pdf?: string;
        thumb_pdf_h?: string;
        thumb_pdf_w?: string;
        thumb_tiny?: string;
        thumb_video?: string;
        thumb_video_h?: number;
        thumb_video_w?: number;
        updated?: number;
        url_static_preview?: string;
        vtt?: string;
    }

    export interface ViewStateValue {
        type: string;
        value?: string | null;
        selected_date?: string | null;
        selected_time?: string | null;
        selected_date_time?: number | null; // UNIX timestamp value
        selected_conversation?: string | null;
        selected_channel?: string | null;
        selected_user?: string | null;
        selected_option?: ViewStateSelectedOption | null;
        selected_conversations?: string[];
        selected_channels?: string[];
        selected_users?: string[];
        selected_options?: ViewStateSelectedOption[];
        rich_text_value?: RichTextBlock;
        files?: UploadedFile[]; // type: "file_input"
    }

    export interface ViewOutput {
        id: string;
        callback_id: string;
        team_id: string;
        app_installed_team_id?: string;
        app_id: string | null;
        bot_id: string;
        title: PlainTextElement;
        type: string;
        blocks: (KnownBlock | Block)[];
        close: PlainTextElement | null;
        submit: PlainTextElement | null;
        state: {
            values: {
                [blockId: string]: {
                    [actionId: string]: ViewStateValue;
                };
            };
        };
        hash: string;
        private_metadata: string;
        root_view_id: string | null;
        previous_view_id: string | null;
        clear_on_close: boolean;
        notify_on_close: boolean;
        external_id?: string;
    }

    export interface ViewUpdateResponseAction {
        response_action: 'update';
        view: View;
    }

    export interface ViewPushResponseAction {
        response_action: 'push';
        view: View;
    }

    export interface ViewClearResponseAction {
        response_action: 'clear';
    }

    export interface ViewErrorsResponseAction {
        response_action: 'errors';
        errors: {
            [blockId: string]: string;
        };
    }

    export type ViewResponseAction =
        | ViewUpdateResponseAction
        | ViewPushResponseAction
        | ViewClearResponseAction
        | ViewErrorsResponseAction;
}