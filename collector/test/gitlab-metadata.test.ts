import {afterEach,describe,expect,it,vi} from 'vitest';
import {gitlabHeads} from '../src/platforms/gitlab-metadata';
afterEach(()=>vi.unstubAllGlobals());
describe('GitLab read-only metadata',()=>{
 it('requires an explicitly configured key without probing credentials',async()=>await expect(gitlabHeads({} as Env)).rejects.toThrow('GITLAB_READ_TOKEN'));
 it('uses repository-file HEAD metadata compatible with read_repository',async()=>{const fetcher=vi.fn(async()=>new Response(null,{headers:{'x-gitlab-commit-id':'a'.repeat(40)}}));vi.stubGlobal('fetch',fetcher);const result=await gitlabHeads({GITLAB_READ_TOKEN:'test'} as unknown as Env);expect(result.repositories).toHaveLength(2);for(const [url,opts]of fetcher.mock.calls as any){expect(url).toMatch(/^https:\/\/gitlab.lrz.de\/api\/v4\/projects\/isdo.ase26%2Fase26_exercise_[01]\/repository\/files\/README.md\?ref=main$/);expect(opts.redirect).toBe('manual');expect(opts.method).toBe('HEAD');}});
 it('does not declare inaccessible sources complete',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:401})));await expect(gitlabHeads({GITLAB_READ_TOKEN:'test'} as unknown as Env)).rejects.toThrow('HTTP401');});
});
