// Keep earlier deployments' settings working while preferring the current names.
export function trainerPlusEnv(name) {
  return process.env[`TRAINER_PLUS_${name}`] ?? process.env[`LIFTMORROW_${name}`];
}
