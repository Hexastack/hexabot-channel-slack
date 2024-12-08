# Hexabot SLack Channel Extension

The Slack Channel Extension for Hexabot Chatbot / Agent Builder

This guide walks you through integrating Slack with [Your Chatbot Builder Name]. With this integration, you can connect your chatbot to a Slack workspace and enable seamless interaction.

## Prerequisites

1. A Slack workspace.

2. Admin access to create and configure Slack apps.

3. A running instance of Hexabot.

If your app is not hosted publicly, you can use a tool like **ngrok** or similar to expose your local development server to the internet. This is required for Slack to communicate with your app

## Steps to Integrate

### 1. Create a Slack App

You have two options to create a Slack app: **From Scratch** or **From Manifest** .

---

#### Option 1: Create App From Scratch

1. Go to [Slack API Apps]() and click **Create New App** .

2. Choose **From Scratch** .

3. Enter a name for your app and select the Slack workspace where it will be installed.

4. Configure the app as follows:

- **OAuth & Permissions** :

  1. Navigate to **OAuth & Permissions** in the sidebar.
  2. Add the following **Bot Token Scopes** under **Scopes** :

     | Scope             | Purpose                                                                     |
     | ----------------- | --------------------------------------------------------------------------- |
     | app_mentions:read | Allows the bot to read messages where it is mentioned.                      |
     | channels:join     | Enables the bot to join public channels automatically.                      |
     | channels:read     | Provides access to metadata about public channels in the workspace.         |
     | chat:write        | Lets the bot send messages in conversations.                                |
     | commands          | Enables the use of slash commands in Slack.                                 |
     | im:history        | Grants access to the direct message history where the bot is a participant. |
     | users:read        | Allows the bot to read user information in the workspace.                   |
     | files:read        | Lets the bot view files shared in the workspace.                            |
     | files:write       | Allows the bot to upload and manage files in the workspace.                 |

  3. Save the changes.

- **Event Subscriptions** :

  1. Enable **Event Subscriptions** in the app settings.
  2. Set the **Request URL** to `{your api domain}/webhook/slack`. This URL must be publicly accessible and capable of verifying Slack's requests.
  3. Add the following **Bot Events** under **Subscribe to Bot Events** :

  - `app_home_opened`
  - `app_mention`
  - `message.im`

  4. Save your changes.

- **Interactivity** :

  1. Navigate to **Interactivity & Shortcuts** in the sidebar.
  2. Enable interactivity and set the **Request URL** to `{your api domain}/webhook/slack`.

  3. Save your changes.

- **App Home** :

  1. Navigate to **App Home** in the sidebar.
  2. Enable the **Home Tab** and ensure the **Messages Tab** is disabled.

  3. Save your changes.

5. Once the configuration is complete, go to **Install App** in the sidebar. Install the app to your workspace and copy the **Bot User OAuth Token** for use in your application.

---

#### Option 2: Create App From Manifest

1. Go to [Slack API Apps]() and click **Create New App** .

2. Choose **From an App Manifest** .

3. Paste the following example manifest into the provided field:

```yaml
display_information:
  name: { Your Bot Name }
features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: { Your Bot Name }
    always_online: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:join
      - channels:read
      - chat:write
      - commands
      - im:history
      - users:read
      - files:read
      - files:write
settings:
  event_subscriptions:
    request_url: { your api domain }/webhook/slack
    bot_events:
      - app_home_opened
      - app_mention
      - message.im
  interactivity:
    is_enabled: true
    request_url: { your api domain }/webhook/slack
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

1. Click **Create** to set up your app automatically with the specified configuration.

---

Both approaches lead to the same result, so choose based on your familiarity and preference. **From Scratch** gives you full control, while **From Manifest** is faster and pre-configured.

### 2. Install the App and Finalize the Integration

- **Install the App** :

  - Go to your Slack app's **Install App** section in the sidebar.
  - Click **Install App to Workspace** and authorize the requested permissions.

- **Retrieve Required Credentials** :

  - After installation, navigate to the **Basic Information** section of your app.
  - Copy the **Signing Secret** .
  - Go to the **OAuth & Permissions** section and copy the **Bot User OAuth Token**.

- **Configure Hexabot** :

  - Go to your **Hexabot Settings** page and open the **Slack Tab** .
  - Paste the **Slack App Access Token** and **Signing Secret** into their respective fields.

- **Complete the Setup** :

  - Save the configuration, and you're all set!

  - Your Slack app is now ready to work with Hexabot.
