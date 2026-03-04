import type { MemoryFact } from '../../contracts/types.js';
import type { FactExtractor } from './types.js';

const TIME_PATTERN = /(加班到|下班(?:时间)?(?:是|到)?|工作到)\s*(\d{1,2}(?::|：)\d{2}|\d{1,2}点半?)/;

function normalizeTime(raw: string): string | null {
  const time = raw.replace(/：/g, ':').trim();
  const hhmm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const dian = time.match(/^(\d{1,2})点(半)?$/);
  if (!dian) return null;
  const hour = Number(dian[1]);
  if (hour < 0 || hour > 23) return null;
  const minute = dian[2] ? 30 : 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export class RuleBasedFactExtractor implements FactExtractor {
  extract(input: { title: string; content: string }): readonly MemoryFact[] {
    const text = `${input.title}\n${input.content}`;
    const matched = text.match(TIME_PATTERN);
    if (!matched) return [];

    const normalized = normalizeTime(matched[2]);
    if (!normalized) return [];

    return [
      {
        key: 'work_schedule.off_time',
        value: normalized,
        confidence: 0.95,
        source: 'rule',
      },
    ];
  }
}
