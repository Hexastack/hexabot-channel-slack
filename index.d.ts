import DEFAULT_SLACK_SETTINGS, { SLACK_GROUP_NAME } from './settings';

declare global {
  interface Settings extends SettingTree<typeof DEFAULT_SLACK_SETTINGS> {}
}

declare module '@nestjs/event-emitter' {
  interface IHookExtensionsOperationMap {
    [SLACK_GROUP_NAME]: TDefinition<
      object,
      SettingMapByType<typeof DEFAULT_SLACK_SETTINGS>
    >;
  }
}
