import type { ImageSourcePropType } from 'react-native';

export const hero = require('../assets/photos/training.jpg');

export const exercisePhotos: Record<string, ImageSourcePropType> = {
  'goblet-squat': require('../assets/photos/goblet-squat.jpg'),
  'dumbbell-bench-press': require('../assets/photos/dumbbell-bench-press.jpg'),
  'dumbbell-row': require('../assets/photos/dumbbell-row.jpg'),
  'push-up': require('../assets/photos/push-up.jpg'),
  'reverse-lunge': require('../assets/photos/reverse-lunge.jpg'),
  'forearm-plank': require('../assets/photos/forearm-plank.jpg'),
};
