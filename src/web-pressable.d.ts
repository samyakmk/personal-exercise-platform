import 'react-native';

declare module 'react-native' {
  interface PressableStateCallbackType {
    // React Native for Web supplies this state in addition to pressed.
    readonly hovered?: boolean;
  }

  interface AccessibilityProps {
    'aria-current'?: 'page';
    'aria-level'?: 1 | 2 | 3;
    'aria-pressed'?: boolean;
  }

  interface PressableProps {
    dataSet?: Record<string, string>;
  }
}
