import { describe, expect, it } from 'vitest';
import { buildJobKey } from '../../src/types/job.js';

describe('buildJobKey (specs/06-data-model.md)', () => {
  it('joins source and jobId with a # separator', () => {
    expect(buildJobKey('seek', '87654321')).toBe('seek#87654321');
  });

  it('is stable across sources', () => {
    expect(buildJobKey('indeed', '1')).toBe('indeed#1');
    expect(buildJobKey('linkedin', '1')).toBe('linkedin#1');
  });
});
