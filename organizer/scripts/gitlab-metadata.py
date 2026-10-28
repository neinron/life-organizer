#!/usr/bin/env python3
"""Read only the two configured ASE repository heads; never browser cookies."""
import argparse,json,os,urllib.request,urllib.error,urllib.parse
from datetime import datetime,timezone
from pathlib import Path
PROJECTS=['isdo.ase26/ase26_exercise_0','isdo.ase26/ase26_exercise_1']
def read(project,token=None):
    url='https://gitlab.lrz.de/api/v4/projects/'+urllib.parse.quote(project,safe='')+'/repository/files/README.md?ref=main'
    headers={'Accept':'application/json'}
    if token:headers['PRIVATE-TOKEN']=token
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args):return None
    try:
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url,headers=headers,method='HEAD'),timeout=20) as response:sha=response.headers.get('X-Gitlab-Commit-Id','')
    except urllib.error.HTTPError as error:
        if error.code in [401,403,404]:return {'project':project,'status':'access_required','http_status':error.code}
        raise
    if len(sha)!=40 or any(c not in '0123456789abcdef' for c in sha):raise ValueError('Invalid GitLab commit response')
    return {'project':project,'branch':'main','sha':sha,'url':'https://gitlab.lrz.de/'+project+'/-/commit/'+sha,'status':'ok'}
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    # A separately approved read_repository token may be supplied by the caller.
    # No .env, Keychain, browser state or Cloudflare secret probing.
    rows=[read(project,os.environ.get('GITLAB_READ_TOKEN')) for project in PROJECTS]
    data={'checked_at':datetime.now(timezone.utc).isoformat(),'complete':all(r['status']=='ok' for r in rows),'repositories':rows}
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');print(json.dumps(data))
