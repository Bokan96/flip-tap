/*
 * Achievement names and descriptions (content: edit freely to reskin).
 * The rule for each id lives in src/meta/achievements.ts.
 */
export interface AchievementDef {
  id: string;
  name: string;
  text: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'firstWin', name: 'First Victory', text: 'Win a match against the CPU.', icon: '★' },
  { id: 'untouchable', name: 'Untouchable', text: 'Win a match without losing any life.', icon: '◇' },
  { id: 'cleanRead', name: 'Clean Read', text: 'Dodge 3 attacks in one round.', icon: '↯' },
  { id: 'bully', name: 'Relentless', text: 'Land 3 hits in one round.', icon: '»' },
  { id: 'overkill', name: 'Overkill', text: 'Deal 60 or more damage in a single step.', icon: '✸' },
  { id: 'lastStand', name: 'Last Stand', text: 'Win with 10 life or less.', icon: '♥' },
  { id: 'thief', name: 'Life Thief', text: 'Heal 50 life with drain attacks in one match.', icon: '✚' },
  { id: 'payback', name: 'Payback', text: 'Knock out your opponent with a counter.', icon: '↺' },
  { id: 'hardWay', name: 'The Hard Way', text: 'Beat the CPU on Hard or Expert.', icon: '⚑' },
  { id: 'mastermind', name: 'Mastermind', text: 'Beat the CPU on Expert.', icon: '✪' },
  { id: 'champion', name: 'Champion', text: 'Finish a tournament ladder.', icon: '♛' },
  { id: 'grandChampion', name: 'Grand Champion', text: 'Finish the tournament with every fighter.', icon: '♚' },
  { id: 'dailyHabit', name: 'Daily Habit', text: 'Win the daily challenge 3 days in a row.', icon: '☀' },
  { id: 'collector', name: 'Collector', text: 'Own every bonus card.', icon: '❖' },
];
