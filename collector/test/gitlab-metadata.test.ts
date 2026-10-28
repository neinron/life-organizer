import {afterEach,describe,expect,it,vi} from 'vitest';
import {gitlabHeads} from '../src/platforms/gitlab-metadata';
afterEach(()=>vi.unstubAllGlobals());
describe('GitLab read-only metadata',()=>{
 it('requires an explicitly configured key without probing credentials',async()=>await expect(gitlabHeads({} as Env)).rejects.toThrow('GITLAB_READ_TOKEN'));
 it('reads only the two fixed main branches and does not follow redirects',async()=>{const fetcher=vi.fn(async()=>Response.json({commit:{id:'a'.repeat(40),title:'Update',committed_date:'2026-10-28T10:00:00Z'}}));vi.stubGlobal('fetch',fetcher);const result=await gitlabHeads({GITLAB_READ_TOKEN:'test'} as unknown as Env);expect(result.repositories).toHaveLength(2);for(const [url,opts]of fetcher.mock.calls as any){expect(url).toMatch(/^https:\/\/gitlab.lrz.de\/api\/v4\/projects\/isdo.ase26%2Fase26_exercise_[01]\/repository\/branches\/main$/);expect(opts.redirect).toBe('manual');expect(opts.method).toBeUndefined();}});
 it('does not declare inaccessible sources complete',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:401})));await expect(gitlabHeads({GITLAB_READ_TOKEN:'test'} as unknown as Env)).rejects.toThrow('HTTP401');});
});
