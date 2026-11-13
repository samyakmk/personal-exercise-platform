import 'react-native';

declare module 'react-native' {
  interface PressableStateCallbackType {
    // React Native for Web supplies this state in addition to pressed.
    readonly hovered?: boolean;
  }
}
