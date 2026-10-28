#!/usr/bin/env python3
"""يحوّل نسخة Claude (claude-artifact/tracker.html) إلى النسخة المستقلة public/index.html
(الاتصال بالخادم بدل قاعدة بيانات Claude، ودخول حقيقي بالجلسات).
الاستخدام:  python3 tools/build-standalone.py [المصدر] [الوجهة]"""
import re,sys,os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src=sys.argv[1] if len(sys.argv)>1 else os.path.join(root,'claude-artifact','tracker.html')
dst=sys.argv[2] if len(sys.argv)>2 else os.path.join(root,'public','index.html')
h=open(src,encoding='utf-8').read()
def rep(a,b):
    global h
    assert h.count(a)==1,(h.count(a),a[:70]);h=h.replace(a,b)
SHIM=r'''<script>
(()=>{const L=[];let es=null,pt=null,seen={};
const api=async(m,u,b)=>{const r=await fetch(u,{method:m,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'qmt'},body:b===undefined?undefined:JSON.stringify(b)});
if(r.status===401){window.dispatchEvent(new Event('unauth'));throw new Error('انتهت الجلسة، سجّل الدخول من جديد')}
const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('خطأ '+r.status));return j};
const snap=a=>({docs:a.map(d=>({id:d.id,data:()=>d.data}))});
const check=async()=>{if(document.hidden)return;try{const v=await api('GET','/api/v');L.forEach(l=>{if(seen[l.c]!==v[l.c]){seen[l.c]=v[l.c];l.f()}})}catch(e){}};
const stream=()=>{if(!pt)pt=setInterval(check,4000);if(es)return;try{es=new EventSource('/api/stream');es.onmessage=()=>check();es.onerror=()=>{}}catch(e){}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
window.DB={collection:c=>({async get(){return snap(await api('GET','/api/c/'+c))},onSnapshot(cb){const l={c,last:undefined,f:async()=>{try{const a=await api('GET','/api/c/'+c),t=JSON.stringify(a);if(t===l.last)return;l.last=t;cb(snap(a))}catch(e){}}};L.push(l);stream();l.f()},async add(o){return{id:(await api('POST','/api/c/'+c,o)).id}}}),
doc:p=>{const[c,...r]=p.split('/'),u=`/api/c/${c}/${encodeURIComponent(r.join('/'))}`;return{async get(){try{const d=await api('GET',u);return{exists:true,data:()=>d}}catch(e){return{exists:false,data:()=>undefined}}},set:o=>api('PUT',u,o),update:o=>api('PATCH',u,o),delete:()=>api('DELETE',u)}},
reloadAll(){stream();L.forEach(l=>{l.last=undefined;l.f()})},closeStream(){if(es){es.close();es=null}clearInterval(pt);pt=null}};
})();
</script>
'''
i=h.index('<script>');h=h[:i]+SHIM+h[i:]
m=re.search(r"const db=await claude\.use\('db'\);\s*if\(!db\)\{[^}]*\}",h);assert m
h=h[:m.start()]+"const db=window.DB;"+h[m.end():]
rep("try{cur=localStorage.getItem('uid')}catch(e){}","")
i=h.index("sub(db.collection('users')");j=h.index("busy=false;draw()})();",i)+len("busy=false;draw()})();")
subs="\n".join(l for l in h[i:j].split("\n") if l.startswith("sub(db.collection"))
h=h[:i]+"let started=false;\nfunction startSubs(){\n"+subs+"}\nasync function boot(){try{const us=await db.collection('users').get();U=mp(us.docs.map(d=>({id:d.id,...d.data()})));if(!started){started=true;startSubs()}else db.reloadAll()}catch(e){console.error(e)}busy=false;draw()}\nwindow.addEventListener('unauth',()=>{cur=null;busy=false;draw()});\n"+h[j:]
i=h.index("if(a==='login'){");j=h.index("else if(a==='dash')",i)
h=h[:i]+"""if(a==='login'){const n=v('#ln'),p=v('#lp');try{const r=await fetch('/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'qmt'},body:JSON.stringify({name:n,pin:p})}),j=await r.json();if(!r.ok){$('#le').textContent=j.error||'تعذر الدخول';return}cur=j.id;view={t:'d'};busy=true;document.activeElement.blur();draw();await boot()}catch(e){$('#le').textContent='تعذر الاتصال بالخادم'}}
else if(a==='out'){try{await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'qmt'}})}catch(e){}db.closeStream();cur=null;U={};P={};E=[];H=[];RD={};SS={};REL=[];RT=[];AS=[];view={t:'d'};draw()}
"""+h[j:]
k=h.rindex("draw();\n})();")
h=h[:k]+"""busy=true;draw();
(async()=>{try{const m=await (await fetch('/api/me',{credentials:'same-origin'})).json();if(m.id){cur=m.id;await boot()}else{busy=false;draw()}}catch(e){busy=false;draw()}})();
})();"""+h[k+len("draw();\n})();"):]
h=h.replace("جاري تجهيز البيانات الأولية، لحظات…","جاري التحميل…")
os.makedirs(os.path.dirname(dst),exist_ok=True);open(dst,'w',encoding='utf-8').write(h)
print('written',dst,len(h))
