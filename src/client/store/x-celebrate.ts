// Pure helpers for StreakCelebrate + the Summary streak card (no DOM, no store): copy derivation and the
// "badges unlocked by THIS session" diff. Everything is derived through computeStreak, nothing is stored.
import { computeStreak, type BadgeView, type Celebrate, type StreakView } from '../../shared/streak';
import type { Session, Settings } from '../../shared/types';

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const word = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => `${word(n)} ${n === 1 ? one : many}`;

/** "Two months" (8 weeks), "Seven weeks", "Half a year" (26), "A full year" (52+): the sentence-initial span of a streak. */
export function streakSpan(weeks: number): string {
  if (weeks >= 52) return weeks >= 104 ? plural(Math.floor(weeks / 52), 'year', 'years') : 'A full year';
  if (weeks === 26) return 'Half a year';
  if (weeks >= 8) return plural(Math.min(12, Math.floor(weeks / 4)), 'month', 'months');
  return plural(Math.max(1, weeks), 'week', 'weeks');
}

export interface CelebrateCopy {
  headline: string;
  /** the count-up starts here (n-1; a repair adds the missed week too, so n-2) */
  from: number;
  body: string;
  badge: { title: string; sub: string } | null;
  freeze: { title: string; sub: string } | null;
  tier: { title: string; sub: string } | null;
  next: { title: string; pct: number; sub: string } | null;
}

export function celebrateCopy(c: Celebrate, v: StreakView): CelebrateCopy {
  const repair = c.kind === 'repair';
  const cw = v.currentWeek;
  const n = c.streak;
  const body = repair
    ? `You made up the missed sessions. Your ${n}-week streak is safe, ${cw.done} of ${cw.target} this week.`
    : `${cw.done} of ${cw.target} this week. ${streakSpan(n)} of showing up, any day you liked.`;
  const nt = c.nextTier;
  return {
    headline: repair ? 'Streak saved' : 'week streak!',
    from: Math.max(0, n - (repair ? 2 : 1)),
    body,
    badge: c.badge ? { title: 'Badge unlocked', sub: c.badge.name } : null,
    freeze: c.freezeEarned ? { title: '+1 streak freeze', sub: `${c.freezes} of 2. ${c.freezes >= 2 ? "You're covered for two weeks off." : "You're covered for a week off."}` } : null,
    tier: c.tierChanged && c.tierIndex > 0 ? { title: `New tier: ${c.tierLabel}`, sub: `Tier ${c.tierIndex} reached at ${n} ${n === 1 ? 'week' : 'weeks'}` } : null,
    next: nt ? { title: `Next tier: ${nt.label} at ${nt.at} weeks`, pct: Math.max(0, Math.min(100, Math.round((n / nt.at) * 100))), sub: `${nt.weeksToGo} ${nt.weeksToGo === 1 ? 'week' : 'weeks'} to go · best ever: ${Math.max(v.best, n)}` } : null,
  };
}

/**
 * Badges that this session unlocked: got after it but not before it. Computed as of the session's end, from the
 * sessions that ended no later than it, so the same summary always shows the same badges.
 */
export function newlyUnlockedBadges(sessions: Session[], settings: Partial<Settings>, sessionId: string): BadgeView[] {
  const me = sessions.find((s) => s.id === sessionId);
  if (!me || me.status !== 'completed') return [];
  const at = me.endedAt ?? me.startedAt;
  const upto = sessions.filter((s) => s.status === 'completed' && (s.endedAt ?? s.startedAt) <= at);
  const before = new Set(computeStreak(upto.filter((s) => s.id !== sessionId), settings, at).badges.filter((b) => b.got).map((b) => b.id));
  return computeStreak(upto, settings, at).badges.filter((b) => b.got && !before.has(b.id));
}
