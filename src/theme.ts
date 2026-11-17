import { Platform } from 'react-native';

export const color = {
  canvas: '#f2eee5',
  surface: '#faf7ef',
  text: '#20261e',
  muted: '#566055',
  faint: '#616b60',
  line: '#d6d4c7',
  control: '#818a77',
  soft: '#ece8dc',
  ink: '#102e1d',
  inkHover: '#21442e',
  inkLine: '#3b5642',
  onInk: '#c2cfc0',
  forest: '#31583a',
  accent: '#d9ef77',
  accentHover: '#e7f795',
  tint: '#e7ebdb',
  danger: '#923b30',
  dangerHover: '#793025',
  dangerSoft: '#f5e6dd',
};

export const radius = { panel: 4, control: 3 };

export const font = {
  regular: 'InterRegular',
  medium: 'InterMedium',
  semibold: 'InterSemiBold',
  bold: 'InterBold',
  extra: 'InterExtraBold',
  display: Platform.OS === 'web' ? 'Georgia, "Times New Roman", serif' : 'InstrumentSerif',
  mono: Platform.OS === 'web' ? 'ui-monospace, "SFMono-Regular", Consolas, monospace' : Platform.OS === 'ios' ? 'Menlo' : 'monospace',
};
