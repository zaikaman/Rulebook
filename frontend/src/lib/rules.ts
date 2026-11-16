import { draftFromRule, readableSentence, type Rule } from '@rulebook/shared';

/** A rule rendered back as the sentence its owner signed, or a labelled fallback. */
export function ruleSentence(rule: Rule): string {
  try {
    return readableSentence(draftFromRule(rule));
  } catch {
    return `Rule #${rule.rule_id.toString()}`;
  }
}

/** ISO timestamp as a short, timezone-explicit label; `—` when the rule never ran. */
export function lastRunLabel(rule: Rule): string {
  if (!rule.last_run_at) return 'never';
  return new Date(rule.last_run_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
