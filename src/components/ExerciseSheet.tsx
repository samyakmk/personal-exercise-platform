import { useTrainingNavigation } from '../navigation';
import { Plus, Video } from 'lucide-react-native';
import { View } from 'react-native';
import { Demonstration } from '../platform/Demonstration';
import { color } from '../theme';
import type { Exercise } from '../types';
import { Sheet } from './Sheet';
import { Button, Copy, Tag } from './ui';

export function ExerciseSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const training = useTrainingNavigation();
  function open(type: 'add' | 'review') {
    onClose();
    training.open({ type, exerciseId: exercise.id });
  }

  return <Sheet title={exercise.name} detail={exercise.description} onClose={onClose}>
    <Demonstration exercise={exercise} />
    <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
      {exercise.muscles.map((muscle) => <Tag key={muscle}>{muscle}</Tag>)}
      <Tag style={{ backgroundColor: color.limeSoft }}>{exercise.equipment.join(' · ') || 'Bodyweight'}</Tag>
    </View>
    <View style={{ gap: 9 }}>
      <Copy size={16} weight="bold">How to do it</Copy>
      {exercise.cues.map((cue, index) => (
        <View key={cue} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
          <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: color.limeSoft, borderRadius: 12 }}>
            <Copy weight="bold" size={11}>{index + 1}</Copy>
          </View>
          <Copy tone={color.muted} size={13} style={{ flex: 1 }}>{cue}</Copy>
        </View>
      ))}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button kind="primary" icon={Plus} onPress={() => open('add')}>Add to workout</Button>
      <Button icon={Video} onPress={() => open('review')}>Upload my form</Button>
    </View>
  </Sheet>;
}
