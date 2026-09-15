// Run with PLAYWRIGHT_MODULE pointing to an existing playwright/core install.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
(async () => {
 const browser = await chromium.launch({channel:'msedge', headless:true});
 const page = await browser.newPage({reducedMotion:'reduce'});
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const base = 'http://127.0.0.1:8765/';
 await page.route('**/*', async route => {
   const url = new URL(route.request().url());
   if (url.origin !== new URL(base).origin) return route.abort();
   if (url.pathname === '/index.html') return route.fulfill({contentType:'text/html', body:fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
   return route.continue();
 });
 await page.goto(base+'index.html');
 await page.evaluate(() => {
   window.userData = {username:'Test', statsData:{players:[]}};
   window.escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   window.getPlayerStats = () => null;
   window.FZPool = {get:()=>'Test'};
 });
 for (const script of ['icons.js','draftkitData.js','fzToday.js','careerFetch.js','careerModal.js','careerTeamLogo.js','teamColors.js','careerTotals.js','accueil-carousel.js','accueil-watch.js','accueil-dash.js','accueil-mobile.js','accueil-season.js','accueil-draft.js']) await page.addScriptTag({url:base+script});
 await page.evaluate(async () => {
   await FZDraftKit.charger(); await loadOffseasonWatchlist();
   window.fixtureState = {mode:'draft',poolData:{draftOrder:['Équipe test','Autre'],currentPickIndex:0,teams:{'Équipe test':{members:['Test']}},config:{numOffensive:6}},team:{name:'Équipe test',data:{}}};
   fzdHeroState = () => window.fixtureState;
   fzdNombreDeChoix = () => 0;
   fzdStopHeroTimer = () => {};
   activeRosterNames = () => [];
   fetchNhlNews = async () => [];
   rosterTeamCounts = () => ({});
   fzmLoadActivity = () => {};
   fzmLeagueData = {all:Array.from({length:12}, (_,i) => ({kind:'signing',item:{playerName:'Joueur '+i,teamAbbrev:'MTL',team:'MTL',date:'2026-09-15'}})),trade:[],signing:[],injury:[],counts:{all:12},tracking:true};
   calData = {days:Array.from({length:7},(_,i)=>({date:`2026-09-${14+i}`,games:[]})),preSeasonStartDate:'2026-09-20',regularSeasonStartDate:'2026-10-06'};
   calSelectedDate = '2026-09-14';
   document.getElementById('fzDashSection').style.display='block';
   document.documentElement.classList.add('fz-auth');
   document.documentElement.classList.remove('fz-anon');
   renderDraftHome({tonight:{games:[]},activeName:'Test'});
   window.fzChargerCarriere = async id => ({playerName:'Joueur test',currentTeam:'ANA',position:'G',seasons:[{season:'20252026',league:'NHL',gameType:'regular',team:'ANA',gp:40,wins:20,losses:15,otLosses:5,savePct:.915,gaa:2.5,shutouts:3},{season:'20242025',league:'AHL',gameType:'playoffs',team:'ANA',gp:5,goals:2,assists:3,points:5}]});
 });
 for (const width of [1440,1024,768,390]) {
   await page.setViewportSize({width,height:1000});
   await page.waitForTimeout(200);
   if (!(await page.locator('#fzhCalendarSlot').isVisible())) await page.locator('.fzh-calendar-button').click();
   for (const date of ['2026-09-17','2026-09-18']) {
     const button = page.locator(`[data-date="${date}"]`);
     await button.scrollIntoViewIfNeeded();
     const box = await button.boundingBox();
     await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
     await page.mouse.down();
     await page.evaluate(() => renderCalendar());
     await page.mouse.up();
     assert.equal(await page.locator(`[data-date="${date}"]`).getAttribute('aria-pressed'),'true');
     await button.focus(); await button.press('Enter');
     assert.equal(await button.evaluate(el => el === document.activeElement),true);
   }
   const report = await page.evaluate(() => ({body:document.documentElement.scrollWidth, viewport:innerWidth, track:document.querySelector('.fzh-watch-track').getBoundingClientRect().height, clickable:document.querySelectorAll('[data-watch-index]').length}));
   console.log('draft',width,report);
   assert.ok(report.body <= width, 'body overflow');
   await page.locator('[data-watch-panel] select').selectOption('ANA');
   assert.equal(await page.locator('.fzh-watch-row').count(),3);
   await page.locator('[data-watch-panel] select').selectOption('all');
   const track = page.locator('.fzh-watch-track');
   await track.evaluate(el => el.scrollTo({left:el.scrollWidth,behavior:'instant'}));
   await page.waitForTimeout(50);
   assert.equal(await page.locator('[data-watch-next]').isDisabled(),true);
   assert.ok(await page.locator('[data-watch-dots] .fzd-off-dot:visible').count()<=5);
   await track.evaluate(el => el.scrollTo({left:0,behavior:'instant'}));
   await page.waitForTimeout(50);
   assert.equal(await page.locator('[data-watch-prev]').isDisabled(),true);
   const star = page.locator('[data-fzh-player]').first();
   await star.click();
   assert.equal(await page.locator('#careerStatsModal').isVisible(),false);
   await page.screenshot({path:path.join(os.tmpdir(),`home-ux-${width}.png`),fullPage:true});
 }
 const first = page.locator('[data-watch-index]').first();
 await first.focus(); await first.press('Enter');
 await page.locator('#careerStatsTable table').waitFor();
 assert.ok((await page.locator('#careerStatsTable').innerText()).includes('% ARR'));
 assert.ok((await page.locator('#fzhWatchCareerNote').innerText()).includes('Dostal'));
 await page.locator('#leagueFilter').selectOption('all');
 await page.locator('#gameTypeFilter').selectOption('all');
 assert.equal(await page.locator('#careerStatsTable tbody tr').count(),2);
 await page.locator('#careerStatsModal').press('Escape');
 assert.equal(await first.evaluate(el => el === document.activeElement),true);
 const second = page.locator('[data-watch-index]').nth(1);
 await second.focus(); await second.press('Space');
 await page.locator('#careerStatsTable table').waitFor();
 assert.ok((await page.locator('#careerStatsTable').innerText()).includes('PTS'));
 assert.ok(!(await page.locator('#careerStatsTable').innerText()).includes('% ARR'));
 await page.locator('#careerStatsModal').press('Escape');
 await page.evaluate(() => { fzhReset(); fixtureState.mode='season'; fzdSeasonStarted=()=>true; FZPool.team=()=>({name:'Équipe test'}); renderSeasonHome({tonight:{games:[],players:[]},activeName:'Test'}); });
 for (const width of [1440,1024,768,390]) {
   await page.setViewportSize({width,height:1000}); await page.waitForTimeout(200);
   assert.equal(await page.locator('.fzh-watch-row').count(),70);
   await page.locator('[data-watch-panel] select').selectOption('ANA');
   assert.equal(await page.locator('.fzh-watch-row').count(),3);
   await page.locator('[data-watch-panel] select').selectOption('all');
   const report = await page.evaluate(() => ({body:document.documentElement.scrollWidth,track:document.querySelector('.fzh-watch-track').getBoundingClientRect().height}));
   console.log('season',width,report); assert.ok(report.body<=width);
   await page.screenshot({path:path.join(os.tmpdir(),`home-ux-season-${width}.png`),fullPage:true});
 }
 await page.evaluate(() => {
   const item = {id:'lead',titre:'Votre tour de repêcher',detail:'Choisissez votre prochain joueur.',pool:'Pool test',href:'draftActif.html',urgence:1};
   window.todayFixture = item;
   FZToday.rendre('fzTodayDash',{vedette:item,secondaires:Array.from({length:9},(_,i)=>({...item,id:String(i)}))});
 });
 const ten = await page.locator('.fzt').evaluate(el => el.getBoundingClientRect().height);
 await page.evaluate(() => FZToday.rendre('fzTodayDash',{vedette:todayFixture}));
 const one = await page.locator('.fzt').evaluate(el => el.getBoundingClientRect().height);
 assert.equal(one,ten); console.log('today heights', {one,ten});
 assert.deepEqual(errors,[]);
 const badgePage = await browser.newPage();
 badgePage.on('pageerror',e=>errors.push(e.message));
 await badgePage.route('**/badge-fixture', route => route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><script defer src="/icons.js"></script><script defer src="/injuries.js"></script><script defer src="/draftkitData.js"></script><script defer src="/draft-watch.js"></script></head><body><table id="playerTable"><tbody></tbody></table></body></html>`}));
 await badgePage.route('**/nhl-injuries**',route => route.fulfill({json:{injuries:[]}}));
 await badgePage.goto(base+'badge-fixture');
 await badgePage.evaluate(() => {
   window.badgeClicks=0;
   const body = document.querySelector('#playerTable tbody');
   body.innerHTML = `<tr><td>${watchBadgeHTML('Lukas Dostal','ANA')}${watchBadgeHTML('Lukas Dostal','MTL')}${watchBadgeHTML('Inconnu','ANA')}</td></tr>`;
   body.addEventListener('click',()=>badgeClicks++);
 });
 await badgePage.locator('.draft-watch-badge').waitFor();
 assert.equal(await badgePage.locator('.draft-watch-badge').count(),1);
 await badgePage.locator('.draft-watch-badge').click();
 assert.equal(await badgePage.evaluate(()=>badgeClicks),1);
 await badgePage.evaluate(()=>document.querySelector('#playerTable tbody').insertAdjacentHTML('beforeend',`<tr><td>${watchBadgeHTML('Beckett Sennecke','ANA')}</td></tr>`));
 await badgePage.waitForFunction(()=>document.querySelectorAll('.draft-watch-badge').length===2);
 assert.deepEqual(errors,[]);
 console.log('draft badges: matching, team mismatch, redraw and row click passed');
 await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
