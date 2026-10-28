import { describe, it, expect } from 'vitest';
import { requireTumonlineToken } from '../src/platforms/tumonline-personal';
import { unitTumonline } from '../src/collector/units/tumonline';

describe('truthful personal TUMonline availability', () => {
 it('fails before claiming a successful personal check when no credential exists', async () => {
  const env={CACHE:{get:async()=>null}} as unknown as Env;
  await expect(unitTumonline({env} as any)).rejects.toThrow('not configured');
 });
 it('accepts a previously stored token without returning it', async () => {
  const env={CACHE:{get:async()=> 'p:{"token":"test-only-placeholder"}'}} as unknown as Env;
  await expect(requireTumonlineToken(env)).resolves.toBeUndefined();
 });
});
