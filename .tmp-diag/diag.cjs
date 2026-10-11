
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
(async()=>{

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TMP = path.join(process.env.TEMP || process.env.TMP, 'rv-diag');
const PROF = path.join(TMP, 'profile');
fs.mkdirSync(PROF, { recursive: true });
const PORT = 9333;

const edge = spawn(EDGE, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--remote-allow-origins=*',
  '--user-data-dir=' + PROF,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  '--window-size=390,844',
  '--force-device-scale-factor=3',
  'about:blank'
], { stdio: 'ignore' });

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function getJson(u){ const r = await fetch(u); return r.json(); }

async function waitForBrowser(){ for(let i=0;i<60;i++){ try{ const v = await getJson('http://127.0.0.1:'+PORT+'/json/version'); if(v.webSocketDebuggerUrl) return v; }catch(e){} await sleep(250);} throw new Error('cdp not ready'); }

const ver = await waitForBrowser();
const list = await getJson('http://127.0.0.1:'+PORT+'/json/list');
let page = list.find(t=>t.type==='page' && t.url==='about:blank') || list.find(t=>t.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate:false });
await new Promise((res,rej)=>{ ws.addEventListener('open',res); ws.addEventListener('error',rej); });

let _id = 0;
const pending = new Map();
ws.addEventListener('message', ev=>{ const m = JSON.parse(ev.data); if(m.id && pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result); } if(m.method) listeners(m); });
const _evt = [];
function listeners(m){ _evt.push(m); }
function waitEvent(method, test){ return new Promise(res=>{ const h=(m)=>{ if(m.method===method && (!test||test(m.params))){ const i=_evt.indexOf(m); if(i>=0)_evt.splice(i,1); res(m.params); } }; _evt.push.__h=h; const iv=setInterval(()=>{},0); const w={h}; _h.push(w); res._w=w; }); }
const _h=[];
function onEvent(method, handler){ _h.push({method,handler}); }
function listeners2(m){ if(m.id && pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result); return; } for(const w of _h){ if(m.method===w.method) w.handler(m.params); } }
function cmd(method, params={}){ const id=++_id; return new Promise((res,rej)=>{ pending.set(id,{res,rej}); ws.send(JSON.stringify({id,method,params})); }); }
ws.removeEventListener('message',()=>{});
ws.addEventListener('message', ev=>{ listeners2(JSON.parse(ev.data)); });

// ----- PNG decode (8-bit gray/rgb/rgba, Chrome output) -----
function decodePng(buf){
  let p=8; const chunks=[];
  while(p<buf.length){ const len=buf.readUInt32BE(p); const type=buf.toString('ascii',p+4,p+8); const data=buf.slice(p+8,p+8+len); chunks.push({type,data}); p+=12+len; }
  const ihdr=chunks.find(c=>c.type==='IHDR').data;
  const w=ihdr.readUInt32BE(0), h=ihdr.readUInt32BE(4), bd=ihdr[8], ct=ihdr[9], interlace=ihdr[12];
  const idat=Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>c.data));
  const raw=zlib.inflateSync(idat);
  const ch = ct===6?4:ct===2?3:ct===0?1:ct===4?2:0;
  const bpp=ch; const stride=w*bpp;
  const out=Buffer.alloc(stride*h);
  let off=0;
  for(let y=0;y<h;y++){ const f=raw[off++]; const row=raw.slice(off,off+stride); off+=stride;
    for(let x=0;x<stride;x++){ const a=x>=bpp?row[x-bpp]:0; const b=y>0?out[(y-1)*stride+x]:0; const c=(x>=bpp&&y>0)?out[(y-1)*stride+x-bpp]:0; let v=row[x];
      if(f===1)v=(v+a)&255; else if(f===2)v=(v+b)&255; else if(f===3)v=(v+((a+b)>>1))&255; else if(f===4){ const pp=a+b-c; const pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c); const pr=pa<=pb&&pa<=pc?a:pb<=pc?b:c; v=(v+pr)&255; }
      out[y*stride+x]=v; } }
  return {w,h,ch,data:out};
}
function avgColor(img){ let r=0,g=0,b=0,n=0; for(let i=0;i<img.data.length;i+=img.ch){ r+=img.data[i]; g+=img.data[i+1]; b+=img.data[i+2]; n++; } return [Math.round(r/n),Math.round(g/n),Math.round(b/n)]; }

// ---------- setup ----------
await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable');
await cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
await cmd('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
await cmd('Emulation.setEmulatedMedia',{features:[{name:'pointer',value:'coarse'},{name:'any-pointer',value:'coarse'},{name:'hover',value:'none'},{name:'any-hover',value:'none'}]});
await cmd('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});

let pendingReqs=0; const reqT=new Map();
onEvent('Network.requestWillBeSent',p=>{ pendingReqs++; reqT.set(p.requestId,1); });
onEvent('Network.loadingFinished',p=>{ if(reqT.delete(p.requestId))pendingReqs--; });
onEvent('Network.loadingFailed',p=>{ if(reqT.delete(p.requestId))pendingReqs--; });

async function navigate(url){
  const loaded=cmd('Page.loadEventFired');
  await cmd('Page.navigate',{url});
  await Promise.race([loaded, sleep(10000)]);
  for(let i=0;i<40;i++){ if(pendingReqs<=0){ await sleep(550); if(pendingReqs<=0) break; } await sleep(250); }
  await sleep(900);
}

async function evalJs(expr){
  const r=await cmd('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description||r.exceptionDetails.text));
  return r.result.value;
}
async function shot(name,full){
  let clip=null;
  if(full){ const m=await evalJs('JSON.stringify({w:document.documentElement.scrollWidth,h:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)})'); const d=JSON.parse(m); clip={x:0,y:0,width:Math.max(d.w,390),height:Math.max(d.h,844),scale:1}; }
  const r=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:!!full,...(clip?{clip}:{})});
  fs.writeFileSync(path.join(TMP,name+'.png'),Buffer.from(r.data,'base64'));
  return name+'.png';
}
async function shotClip(name,x,y,w,h){
  const r=await cmd('Page.captureScreenshot',{format:'png',clip:{x,y,width:w,height:h,scale:1}});
  const buf=Buffer.from(r.data,'base64');
  fs.writeFileSync(path.join(TMP,name+'.png'),buf);
  return {buf};
}

// ---------- in-page diagnostic bundle ----------
const DIAG = `(()=>{
 const pick=(el,ps)=>{ if(!el) return null; const cs=getComputedStyle(el,ps||null); const r=el.getBoundingClientRect(); return {sel:ps||null, tag:el.tagName.toLowerCase(), cls:el.className&&el.className.toString().slice(0,120), rect:{x:+r.x.toFixed(1),y:+r.top.toFixed(1),top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),left:+r.left.toFixed(1),right:+r.right.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}, position:cs.position, display:cs.display, visibility:cs.visibility, background:cs.background, backgroundColor:cs.backgroundColor, backgroundImage:cs.backgroundImage.slice(0,300), backdropFilter:cs.backdropFilter, webkitBackdropFilter:cs.webkitBackdropFilter, borderRadius:cs.borderRadius, boxShadow:cs.boxShadow.slice(0,300), borderTop:cs.borderTop, borderBottom:cs.borderBottom, left:cs.left, right:cs.right, top:cs.top, bottom:cs.bottom, paddingTop:cs.paddingTop, paddingBottom:cs.paddingBottom, zIndex:cs.zIndex, opacity:cs.opacity }; };
 const out={viewport:{iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio,touch:('ontouchstart' in window),pointer:matchMedia('(pointer:coarse)').matches, scrollY:scrollY},
   doc:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight},
   body:pick(document.body), app:pick(document.getElementById('app')), rvPage:pick(document.querySelector('.rv-page')),
   bottomnav:pick(document.querySelector('.bottomnav')),
   topbar:pick(document.querySelector('.top-bar')), header:pick(document.querySelector('header')), rvHead:pick(document.querySelector('.rv-head')) };
 // pseudo elements
 const bn=document.querySelector('.bottomnav');
 if(bn){
   out.bnBefore=(()=>{ const cs=getComputedStyle(bn,'::before'); return {content:cs.content, position:cs.position, top:cs.top,bottom:cs.bottom,left:cs.left,right:cs.right,width:cs.width,height:cs.height, backgroundImage:cs.backgroundImage.slice(0,400), background:cs.background.slice(0,300), opacity:cs.opacity, transform:cs.transform, zIndex:cs.zIndex, borderRadius:cs.borderRadius}; })();
   out.bnAfter=(()=>{ const cs=getComputedStyle(bn,'::after'); return {content:cs.content,position:cs.position,top:cs.top,bottom:cs.bottom,height:cs.height,backgroundImage:cs.backgroundImage.slice(0,300),opacity:cs.opacity}; })();
   // scan descendants for gradient pseudo layers
   out.bnChildPseudos=[];
   bn.querySelectorAll('*').forEach(c=>{ ['::before','::after'].forEach(ps=>{ const cs=getComputedStyle(c,ps); if(cs.content!=='normal'&&cs.content!=='none' && (cs.backgroundImage!=='none'||cs.position==='absolute')){ out.bnChildPseudos.push({cls:(c.className||'').toString().slice(0,80),ps,content:cs.content.slice(0,40),position:cs.position,h:cs.height,bgImg:cs.backgroundImage.slice(0,200)}); } }); });
   // tap light effect hints: active styles not directly readable; collect CSS rules for .bottomnav :active
 }
 // content padding & overlap
 const main=document.querySelector('.rv-page')||document.getElementById('app');
 if(main){
   const cs=getComputedStyle(main);
   out.mainPadding={paddingTop:cs.paddingTop,paddingBottom:cs.paddingBottom};
   const kids=Array.from(main.querySelectorAll(':scope >*'));
   out.mainChildren=kids.slice(-4).map(k=>{const r=k.getBoundingClientRect();return{tag:k.tagName.toLowerCase(),cls:(k.className||'').toString().slice(0,80),top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),h:+r.height.toFixed(1)};});
   // deepest last visible block
   const all=Array.from(main.querySelectorAll('*')).filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.width>0;});
   const last=all.map(e=>({e,r:e.getBoundingClientRect()})).sort((a,b)=>b.r.bottom-a.r.bottom)[0];
   if(last){ out.lastBlock={tag:last.e.tagName.toLowerCase(),cls:(last.e.className||'').toString().slice(0,80),rectBottom:+last.r.bottom.toFixed(1)}; }
   if(bn){ const br=bn.getBoundingClientRect(); out.overlap={navTop:+br.top.toFixed(1), navBottom:+br.bottom.toFixed(1)}; }
 }
 // fixed/sticky overflow list
 out.fixedSticky=[];
 document.querySelectorAll('*').forEach(e=>{ const cs=getComputedStyle(e); if(cs.position==='fixed'||cs.position==='sticky'){ const r=e.getBoundingClientRect(); if(r.height>0&&r.width>0){ out.fixedSticky.push({tag:e.tagName.toLowerCase(),cls:(e.className||'').toString().slice(0,80),position:cs.position,left:+r.left.toFixed(1),right:+r.right.toFixed(1),w:+r.width.toFixed(1),top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),overX:+ (r.right-390).toFixed(1)}); } } });
 out.fixedSticky.sort((a,b)=>b.overX-a.overX);
 // safe-area usage in stylesheets
 out.safeAreaRules=[];
 try{ for(const sheet of document.styleSheets){ let rules; try{rules=sheet.cssRules;}catch(e){continue;} for(const rule of rules){ const t=rule.cssText||''; if(/safe-area|env\(/.test(t)){ out.safeAreaRules.push(t.slice(0,300)); if(out.safeAreaRules.length>=40)break; } } } }catch(e){out.safeAreaErr=String(e);}
 // cards
 out.cards=Array.from(document.querySelectorAll('.rv-card')).slice(0,3).map(c=>pick(c));
 // nav-related rules (active/light)
 out.bnRules=[];
 try{ for(const sheet of document.styleSheets){ let rules; try{rules=sheet.cssRules;}catch(e){continue;} for(const rule of rules){ const t=rule.cssText||''; if(/bottomnav|bottom-nav/i.test(t)){ out.bnRules.push(t.slice(0,260)); if(out.bnRules.length>=25)break; } } } }catch(e){}
 return JSON.stringify(out);
})()`;

async function diag(){ return JSON.parse(await evalJs(DIAG)); }

const results={shots:[],pages:{}};

// ===== HOME =====
await navigate('http://localhost:5175/');
results.shots.push(await shot('01-home-fullpage',true));
results.shots.push(await shot('02-home-viewport-top',false));
results.pages.home=await diag();

// scroll 600 (find real scroller)
await evalJs('(()=>{ const sc=document.scrollingElement; window.scrollTo(0,600); if(window.scrollY<50){ const c=document.querySelector(".rv-page"); if(c){c.scrollTop=600;} } })()');
await sleep(700);
results.pages.homeAfterScroll=JSON.parse(await evalJs('JSON.stringify({scrollY:window.scrollY, rvScroll:(document.querySelector(".rv-page")||{}).scrollTop||0})'));
results.shots.push(await shot('03-home-scroll600',false));
// evidence: center-of-nav pixel with bar visible vs hidden
const nav=await evalJs('(()=>{const n=document.querySelector(".bottomnav"); if(!n)return null; const r=n.getBoundingClientRect(); const cs=getComputedStyle(n); return JSON.stringify({cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),top:r.top,bottom:r.bottom,h:r.height,bg:cs.backgroundColor,bd:cs.backdropFilter,wbd:cs.webkitBackdropFilter});})()');
results.pages.homeAfterScroll.navStyle=JSON.parse(nav);
if(nav){ const n=JSON.parse(nav); const s1=await shotClip('zz-nav-a',n.cx-6,n.cy-4,12,8); await evalJs('document.querySelector(".bottomnav").style.visibility="hidden"'); await sleep(150); const s2=await shotClip('zz-nav-b',n.cx-6,n.cy-4,12,8); await evalJs('document.querySelector(".bottomnav").style.visibility=""'); await sleep(100);
  const i1=decodePng(s1.buf),i2=decodePng(s2.buf); const a=avgColor(i1),b=avgColor(i2);
  results.pages.homeAfterScroll.pixel={withNav:[a[0],a[1],a[2]],withoutNav:[b[0],b[1],b[2]],meanAbsDiff:+(Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3}; }

// ===== QINGZANG =====
await navigate('http://localhost:5175/route/qingzang');
results.shots.push(await shot('04-qingzang-fullpage',true));
results.shots.push(await shot('05-qingzang-viewport-top',false));
results.pages.qingzang=await diag();

// ===== TICKET =====
await navigate('http://localhost:5175/ticket');
results.pages.ticket=JSON.parse(await evalJs('(()=>{ const cards=[...document.querySelectorAll(".rv-card")]; const f=c=>{if(!c)return null;const s=getComputedStyle(c);return{backgroundColor:s.backgroundColor,background:s.background.slice(0,200),backgroundImage:s.backgroundImage.slice(0,200),backdropFilter:s.backdropFilter,webkitBackdropFilter:s.webkitBackdropFilter,boxShadow:s.boxShadow.slice(0,300),border:s.border,borderRadius:s.borderRadius,opacity:s.opacity};}; return JSON.stringify({count:cards.length, first:f(cards[0]), second:f(cards[1])});})()'));

fs.writeFileSync(path.join(TMP,'results.json'),JSON.stringify(results,null,1));
console.log('DONE '+TMP);
ws.close(); edge.kill();
setTimeout(()=>process.exit(0),300);
})().catch(e=>{console.error(e);process.exit(1)});
