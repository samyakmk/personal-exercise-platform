const setActions = ['record set', 'start hold timer', 'stop hold timer', 'use last load'] as const;
const sessionActions = [
  'skip rest', 'start rest timer', 'add 30 seconds', 'skip exercise', 'next exercise', 'undo last set',
  'finish session', 'back to session', 'save session', 'save workout log', 'save separate log',
  'pause session', 'turn off voice commands',
] as const;

export type SetVoiceCommand =
  | { action: typeof setActions[number] }
  | { action: 'report'; amount: number; unit: 'reps' | 'seconds' }
  | { action: 'weight'; load: string; unit: 'kg' | 'lb' };

type WorkoutVoiceCommand = SetVoiceCommand
  | { action: 'ready' | typeof sessionActions[number] }
  | { action: 'message'; question?: string };

const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const small = [...ones, 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function integer(words: string): number | undefined {
  const hundred = /^(one|two|three|four|five|six|seven|eight|nine|a) hundred(?: (?:and )?(.+))?$/.exec(words);
  if (hundred) {
    const rest = hundred[2] ? integer(hundred[2]) : 0;
    if (rest !== undefined && rest < 100) return (hundred[1] === 'a' ? 1 : ones.indexOf(hundred[1])) * 100 + rest;
    return;
  }
  if (words === 'one thousand' || words === 'a thousand') return 1000;
  const exact = small.indexOf(words);
  if (exact >= 0) return exact;
  const [first, second, extra] = words.split(' ');
  const ten = tens.indexOf(first);
  const one = second ? ones.indexOf(second) : 0;
  if (ten >= 0 && one >= 0 && !extra) return (ten + 2) * 10 + one;
}

function numberText(amount: string) {
  if (/^\d{1,4}(?:[.,]\d{1,2})?$/.test(amount)) return amount.replace(',', '.');
  const [whole, fraction, extra] = amount.replace(/-/g, ' ').split(' point ');
  const value = /^\d{1,4}$/.test(whole) ? Number(whole) : integer(whole);
  if (value === undefined || extra !== undefined) return;
  if (!fraction) return String(value);
  if (/^\d{1,2}$/.test(fraction)) return `${value}.${fraction}`;
  const digits = fraction.split(' ').map((word) => ones.indexOf(word));
  if (digits.length <= 2 && digits.every((digit) => digit >= 0)) return `${value}.${digits.join('')}`;
}

export function workoutVoiceCommand(transcript: string): WorkoutVoiceCommand | undefined {
  const phrase = transcript.trim().replace(/^coach\b[,\s]*/i, '');
  if (phrase.length > 320) return;
  const message = /^message (?:the )?coach(?:[,:.?!\s]+(.*))?$/i.exec(phrase);
  if (message) return { action: 'message', question: message[1]?.trim() || undefined };

  const command = phrase.toLowerCase().replace(/[’‘]/g, "'").replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  if (/^(?:(?:ok(?:ay)?|yes)[, ]+)?(?:i(?:'m| am) )?ready$/.test(command)) return { action: 'ready' };
  if (/^add (?:30|thirty) (?:seconds|secs)$/.test(command)) return { action: 'add 30 seconds' };
  if (command === 'stop rest timer' || command === 'stop timer') return { action: 'skip rest' };
  const action = [...setActions, ...sessionActions].find((action) => action === command);
  if (action) return { action };

  const report = /^(?:(?:i )?(?:did |held (?:for )?))?(.+?) *(reps?|seconds?|secs?)$/.exec(command);
  if (report) {
    const amount = numberText(report[1].trim());
    if (amount !== undefined) return { action: 'report', amount: Number(amount), unit: report[2].startsWith('rep') ? 'reps' : 'seconds' };
  }
  const weight = /^(?:set )?weight (?:to )?(.+?) *(kg|kilograms?|lbs?|pounds?)$/.exec(command);
  if (weight) {
    const load = numberText(weight[1].trim());
    if (load !== undefined) return { action: 'weight', load, unit: weight[2].startsWith('k') ? 'kg' : 'lb' };
  }
}
