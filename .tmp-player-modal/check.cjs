const { chromium } = require('C:/Users/Andyz/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const statData = JSON.parse(fs.readFileSync(path.join(root, 'current_stats.json')));
const fixture = {
  playerId:8482116, playerName:'Tim Stützle', currentTeam:'OTT', position:'C', isGoalie:false, sweaterNumber:18,
  headshot:'https://assets.nhle.com/mugs/nhl/20252026/OTT/8482116.png', height:'6′0″',weight:187,
  birthDate:'2002-01-15',birthCity:'Viersen',draftInfo:{year:2020,round:1,pickInRound:3,teamAbbrev:'OTT'},
  seasons:Array.from({length:6},(_,i)=>({season:`${2020+i}-${21+i}`,league:'NHL',team:'Ottawa Senators',gameType:'regular',gp:80,goals:34,assists:49,points:83,plusMinus:7,pim:39,shots:194})).concat([{season:'2019-20',league:'DEL',team:'Adler Mannheim',gameType:'regular',gp:41,goals:7,assists:27,points:34,plusMinus:4,pim:12,shots:81},{season:'2025-26',league:'NHL',team:'Ottawa Senators',gameType:'playoffs',gp:6,goals:2,assists:4,points:6,plusMinus:1,pim:4,shots:20}])
};
function adapters(page) {
  const source=fs.readFileSync(path.join(root,page==='stats.html'?'index.js':page==='draftActif.html'?'draftActif.js':'classement.js'),'utf8');
  const start=source.indexOf('async function showCareerStats(');
  const close=source.indexOf('function closeCareerModal(',start);
  let end=source.indexOf('}',close)+1;
  if(page==='stats.html')end=source.indexOf('function showSkeletonLoader()',close);
  return `let currentCareerData=null; let currentStats=${JSON.stringify(statData)}; const BASE_URL='';\n${source.slice(start,end)}`;
}
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://x').pathname);
 if(pathname==='/nhl-injuries'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({injuries:[]}));}
 const pool={teams:{'Équipe 1':{members:['preview'],offensive:[],defensive:[],rookie:[],goalie:[],teams:[]},'Équipe 2':{members:['preview2'],offensive:[],defensive:[],rookie:[],goalie:[],teams:[]}},config:{numOffensive:6,numDefensive:4,numGoalies:1,numRookies:1,numTeams:1},draftOrder:['Équipe 1','Équipe 2'],currentPickIndex:0,picksHistory:[],poolMode:'cumulative'};
 const payload=pathname==='/current-stats'?statData:pathname==='/current-teams'?{teams:[]}:pathname==='/season-window'?{hasStarted:false}:pathname==='/draft'?{Preview:pool}:pathname==='/draft/Preview'?pool:pathname.startsWith('/user-profile/')?{username:'preview'}:pathname.startsWith('/trades/pending/')?[]:undefined;
 if(payload!==undefined){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(payload));}
 if(pathname.startsWith('/player-career/')) {res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(fixture));}
 if(pathname.startsWith('/player-gamelog/')) {res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({gameLog:[],playerInfo:{isGoalie:false}}));}
 const file=path.join(root,pathname);
 if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
 const ext=path.extname(file); res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[ext]||'application/octet-stream');
 if(pathname==='/careerModal.js'){return res.end(fs.readFileSync(file,'utf8').replace('adapter.onData(data);',"console.log('__CM received'); adapter.onData(data);").replace('renderProfile(data, playerId);',"console.log('__CM profile start'); renderProfile(data, playerId); console.log('__CM profile done');").replace('adapter.renderStats();',"adapter.renderStats(); console.log('__CM table done');"));}
 if(['stats.html','draftActif.html','classement.html'].includes(path.basename(file))&&!req.url.includes('real=1')){
   let html=fs.readFileSync(file,'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'');
   html=html.replace('</body>',`<script>${adapters(path.basename(file))}</script><script src="teamColors.js"></script><script src="careerFetch.js"></script><script src="careerModal.js"></script><script src="careerTeamLogo.js"></script><script src="careerTotals.js"></script></body>`);
   return res.end(html);
 }
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1448,height:1086},deviceScaleFactor:1});
 page.on('console',m=>{if(m.text().startsWith('__CM'))console.log(m.text())});
 page.on('request',r=>{if(r.url().includes('/player-career/'))console.log('CAREER REQUEST',r.url())});
 page.on('response',r=>{if(r.url().includes('/player-career/'))console.log('CAREER RESPONSE',r.status())});
 await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(__dirname,'fonts.css'),'utf8')}));
 await page.route('https://fonts.gstatic.com/**',route=>{const f=path.join(__dirname,new URL(route.request().url()).pathname.split('/').pop());return fs.existsSync(f)?route.fulfill({contentType:'font/ttf',body:fs.readFileSync(f)}):route.abort()});
 await page.route('https://assets.nhle.com/mugs/**',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'portrait.png'))}));
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
 page.on('framenavigated',f=>{if(f===page.mainFrame())console.log('Navigation:',f.url())});
 for(const route of ['stats.html','draftActif.html','classement.html']){
  await page.goto(`${base}/${route}`,{waitUntil:'load'});
  await page.evaluate(()=>showCareerStats(8482116,'Tim Stützle'));
  if(route==='stats.html') console.log('Real current URL',page.url(),errors);
  await page.evaluate(()=>document.fonts.ready);
  if(route==='stats.html') console.log('Computed fonts',await page.evaluate(()=>['.career-modal','.cmh-season-label','.cmh-mini-lbl','#careerStatsTable td','#careerPlayerName'].map(q=>{const s=getComputedStyle(document.querySelector(q));return [q,s.fontFamily,s.fontSize,s.fontWeight]})));
  await page.waitForFunction(()=>document.querySelector('#careerStatsTable .career-team-logo')?.complete);
  assert.equal(await page.locator('#careerPlayerName').textContent(),'Tim Stützle');
  assert.equal(await page.locator('.career-modal').getAttribute('data-team'),'OTT');
  assert.equal(await page.locator('.career-totals-label').getAttribute('colspan'),'2');
  assert.equal(await page.locator('#careerStatsTable .career-team-name').first().textContent(),'OTT');
  await page.screenshot({path:path.join(__dirname,`${route}.png`),animations:'disabled'});
  await page.selectOption('#leagueFilter','all');
  await page.waitForFunction(()=>document.querySelector('.career-totals-label')===null);
  assert.equal(await page.locator('#careerStatsTable tbody tr').count(),7);
  await page.selectOption('#gameTypeFilter','playoffs');
  assert.equal(await page.locator('#careerStatsTable tbody tr').count(),1);
  await page.selectOption('#leagueFilter','other');
  assert.match(await page.locator('#careerStatsTable').textContent(),/Aucune statistique/);
  await page.evaluate(()=>showCareerStats(8482116,'Tim Stützle'));
  await page.click('#careerFavorite');assert.equal(await page.locator('#careerFavorite').getAttribute('aria-pressed'),'true');
  await page.click('#careerFavorite');assert.equal(await page.locator('#careerFavorite').getAttribute('aria-pressed'),'false');
  if(route==='stats.html'){
   await page.selectOption('#viewFilter','gamelog');await page.waitForFunction(()=>document.querySelector('#careerStatsTable').textContent.includes('Aucun match'));
   await page.selectOption('#viewFilter','career');assert.equal(await page.locator('#careerStatsTable tbody tr').count(),7);
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('#careerStatsModal').isVisible(),false);
  console.log('Page/filter/favorite checks:',route);
 }
 await page.evaluate(f=>window.testFixture=f,fixture);
 const codes=await page.evaluate(()=>Object.keys(NHL_TEAM_COLORS).filter(c=>c!=='ARI'));
 for(const code of codes){
  await page.evaluate(async code=>{window.fzChargerCarriere=async()=>({...window.testFixture,currentTeam:code});await showCareerStats(8482116,'Tim Stützle')},code);
  const check=await page.evaluate(()=>{const c=document.querySelector('.career-modal'),s=getComputedStyle(c),r=c.getBoundingClientRect();return {team:c.dataset.team,contrast:1.05/(hexLuminance(s.getPropertyValue('--team-surface').trim())+.05),overflow:document.querySelector('#careerProfileBody').scrollWidth>document.querySelector('#careerProfileBody').clientWidth+1,rect:[r.x,r.width]}});
  assert.equal(check.team,code);assert.ok(check.contrast>=5,`${code} contrast ${check.contrast}`);assert.equal(check.overflow,false,`${code} overflow`);
 }
 console.log('32 team palettes: contrast and desktop overflow pass');
 for(const width of [320,390,768,1024,1448]){
  await page.setViewportSize({width,height:width===1448?1086:844});
  await page.evaluate(async()=>{window.fzChargerCarriere=async()=>({...window.testFixture,currentTeam:'BOS',playerName:'Ryan Nugent-Hopkins'});await showCareerStats(8482116,'Ryan Nugent-Hopkins')});
  const dims=await page.evaluate(()=>{const b=document.querySelector('#careerProfileBody'),m=document.querySelector('.career-modal');return {client:b.clientWidth,scroll:b.scrollWidth,right:m.getBoundingClientRect().right,window:innerWidth}});
  assert.ok(dims.scroll<=dims.client+1,`overflow ${width}: ${JSON.stringify(dims)}`);assert.ok(dims.right<=width);
  await page.screenshot({path:path.join(__dirname,`responsive-${width}.png`),animations:'disabled'});
 }
 console.log('Responsive widths: 320, 390, 768, 1024, 1448 pass');
 // Missing portrait, no current team/stats, and goalkeeper labels.
 await page.evaluate(async()=>{currentStats=null;window.fzChargerCarriere=async()=>({...window.testFixture,headshot:'/missing.png',currentTeam:null,isGoalie:true,position:'G',seasons:[]});await showCareerStats(99,'Goalie')});
 await page.waitForFunction(()=>!document.querySelector('#playerHeadshotContainer img'));
 assert.equal(await page.locator('.career-modal').getAttribute('data-team'),'neutral');
 assert.match(await page.locator('#careerSeasonHighlight').textContent(),/Victoires/);
 // A slow response cannot replace a newer player or resurrect a closed modal.
 await page.evaluate(()=>{window.fzChargerCarriere=()=>new Promise(r=>window.resolveSlow=r);window.slowOpen=showCareerStats(1,'Slow')});
 await page.evaluate(async()=>{window.fzChargerCarriere=async()=>({...window.testFixture,playerName:'New player',currentTeam:'TOR'});await showCareerStats(2,'New player');window.resolveSlow(window.testFixture);await window.slowOpen});
 assert.equal(await page.locator('#careerPlayerName').textContent(),'New player');
 await page.evaluate(()=>{window.fzChargerCarriere=()=>new Promise(r=>window.resolveSlow=r);window.slowOpen=showCareerStats(1,'Slow');closeCareerModal()});
 await page.evaluate(async()=>{window.resolveSlow(window.testFixture);await window.slowOpen});
 assert.equal(await page.locator('#careerStatsModal').isVisible(),false);
 await page.evaluate(async()=>{window.fzChargerCarriere=async()=>{throw new Error('test')};await showCareerStats(1,'Failure')});
 assert.equal(await page.locator('.close-modal').isVisible(),true);assert.equal(await page.locator('#careerStatsTable [role="alert"]').count(),1);
 console.log('Missing data, goalie, failed requests, and stale-response checks pass');
 assert.deepEqual(errors,[]);
 await page.route('https://code.jquery.com/**',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'jquery.js'),'utf8')}));
 await page.route('https://cdn.socket.io/**',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'socket.js'),'utf8')}));
 await page.addInitScript(()=>{localStorage.setItem('username','preview');localStorage.setItem('isLoggedIn','true');localStorage.setItem('activePool','Preview');localStorage.setItem('draftClan','Preview')});
 await page.setViewportSize({width:1448,height:1086});
 for(const route of ['stats.html','classement.html','draftActif.html']){
  if(route==='classement.html')await page.route(/\/draft(?:\?|$)/,r=>r.fulfill({contentType:'application/json',body:'{}'}));
  else await page.unroute(/\/draft(?:\?|$)/);
  console.log('Real goto start',route);
  await page.goto(`${base}/${route}?real=1`,{waitUntil:'load'});
  console.log('Real loaded',route);
  await page.waitForFunction(()=>typeof showCareerStats==='function'&&typeof fzOpenCareerModal==='function');
  console.log('Real functions ready',route);
  console.log('Real before open',await page.evaluate(()=>({modal:!!document.querySelector('#careerStatsModal'),body:!!document.querySelector('#careerProfileBody'),base:BASE_URL})));
  console.log('Real synchronous open',await page.evaluate(()=>{window.realOpen=showCareerStats(8482116,'Tim Stützle');return 'started'}));
  await Promise.race([page.evaluate(()=>window.realOpen),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Open did not resolve')),10000))]);
  console.log('After real open',route,await page.evaluate(()=>({url:location.href,modal:document.querySelector('#careerStatsModal')?.outerHTML.slice(0,1500),open:showCareerStats.toString().slice(0,350)})));
  assert.equal(await page.locator('#careerPlayerName').textContent(),'Tim Stützle');
  assert.equal(await page.locator('#careerStatsTable table').count(),1);
  await page.screenshot({path:path.join(__dirname,`real-${route}.png`),animations:'disabled'});
  if(route==='draftActif.html'){
   await page.waitForFunction(()=>typeof fzToggleFavorite==='function'&&draftData?.draftOrder?.length>0);
   await page.evaluate(()=>showCareerStats(8482116,'Tim Stützle'));
   await page.click('#careerPick');
   assert.equal(await page.locator('#careerStatsModal').isVisible(),false);
   assert.equal(await page.locator('#pickConfirmOverlay').evaluate(e=>e.classList.contains('show')),true);
   console.log('Draft selection opens existing confirmation; no pick submitted');
  }
  console.log('Real page initialization:',route);
 }
 console.log('Real page errors:',errors);
 await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
