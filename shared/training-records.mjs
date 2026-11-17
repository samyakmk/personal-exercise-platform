export function recordedSetCount(movement) {
  return movement.setDetails?.length ?? movement.sets;
}
