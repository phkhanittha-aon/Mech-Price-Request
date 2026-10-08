const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),crypto=require('crypto');
const { makeRuntime } = require('./gasmock'); const DIR=process.argv[2];
const { ctx, sheets } = makeRuntime(DIR+'/Code.gs');
const H=s=>crypto.createHash('sha256').update(s+'mgs-internal-2025').digest('hex');
const U=sheets['Users'],h=U.rows[0];
const add=(id,name,role,email)=>{const r=[];r[h.indexOf('Id')]=id;r[h.indexOf('Name')]=name;r[h.indexOf('Role')]=role;r[h.indexOf('Scope')]='all';r[h.indexOf('PassHash')]=H('pw123456');r[h.indexOf('Email')]=email;U.rows.push(r)};
[['gm','General Manager','GM'],['admin','Admin','Admin'],['procurement','Procurement Manager','Procurement Mgr'],['bd','BD Manager','BD Mgr'],
 ['sourcing1','Chatraporn','Sourcing'],['sales_non','NON','Sales Manager'],['sales_boss','BOSS','Sales']].forEach(u=>add(u[0],u[1],u[2],u[0]+'@mglobalsourcing.net'));
const post=p=>JSON.parse(ctx.apiPost(JSON.stringify(p)));
const tS=post({action:'login',user:'sourcing1',passHash:H('pw123456')}).token;
const today=new Date().toISOString().slice(0,10);
const mk=(id,no,st,cur,owner,rel,extra)=>Object.assign({id,_v:2,_pm:2,_sv:3,docType:'QT',docNo:no,status:st,approvalRoles:['Approved','Pending','Won'].includes(st)?['Procurement Mgr','BD Mgr']:[],approvals:[],releasedTo:rel,auditLogs:[],globalExtras:[],
  created:'2026-08-10',updated:'2026-08-10',updatedAt:'2026-08-10T03:00:00.000Z',round:1,stage:'Approved',followStatus:'Pending',
  header:{ref:no,title:no+' project',customer:'Cust '+no,sales:owner,salesUserId:owner,currency:cur,priceTerm:'Special price',incoterm:'CIF at MGS',exrate:36,rates:{USD:36,CNY:5},offerDate:today,validity:30,groupType:'Inverter'},
  lines:[{code:'SG110CX',desc:'Inverter',group:'INVERTER',comGroup:'Inverter',uom:'pcs',qty:2,up:3000,costCur:'USD',dutyPct:0,clearancePct:2,opPct:20,freep:0}],remarks:[]},extra||{});
function save(q,salesDetail){post({token:tS,action:'save',id:q.id,docNo:q.docNo,status:q.status,salesUserId:q.header.salesUserId,releasedTo:(q.releasedTo||[]).join('|'),title:q.header.title,customer:q.header.customer,currency:q.header.currency,total:270000,gp:20,detail:JSON.stringify(q),salesDetail:salesDetail===undefined?'':salesDetail});}
// legacy-like: Pending, never released in new system, no SalesDetail, last touched 59 days ago
save(mk('L1','P.IN20260705001','Pending','THB','sales_non',[]));
save(mk('L2','P.IN20261505001','Pending','THB','sales_boss',[]));
// legit released USD quote
const sdU={id:'U1',status:'Pending',header:{currency:'USD',title:'USD job',customer:'Cust USD'},lines:[{code:'X',qty:1,unitPrice:10000,amount:10000}],total:10000};
save(mk('U1','QT-USD-1','Pending','USD','sales_boss',['sales_boss']),JSON.stringify(sdU));
save(mk('S1','QT-SUB-1','Submitted','THB','sales_boss',[]));
save(mk('P1','QT-WIP-1','In Progress','THB','sales_boss',[]));
save(mk('A1','QT-APP-1','Approved','THB','sales_boss',[]));
// make the legacy rows look old on the sheet
const Q=sheets['Quotations'],qh=Q.rows[0];Q.rows.forEach((r,i)=>{if(i&&['L1','L2'].includes(r[qh.indexOf('Id')])){r[qh.indexOf('UpdatedAt')]='2026-08-10T03:00:00.000Z';r[qh.indexOf('Updated')]='2026-08-10';}});

const files={'/':fs.readFileSync(DIR+'/Index.html','utf8'),'/sales':fs.readFileSync(DIR+'/Sales.html','utf8')};
const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(files[q.url.split('?')[0]]||files['/'])}).listen(0);
const B='http://localhost:'+srv.address().port;
async function open(b,path,w){const c=await b.newContext({viewport:{width:w||1366,height:860}});const p=await c.newPage();p._errs=[];
  p.on('pageerror',e=>p._errs.push(e.message));
  await p.route('https://script.google.com/**',async route=>{const r=route.request();let body;if(r.method()==='POST')body=ctx.apiPost(r.postData());else{const u=new URL(r.url());const g=k=>u.searchParams.get(k)||'';body=ctx.apiGet(g('type'),g('token'),g('id')||g('since'))}await route.fulfill({status:200,contentType:'application/json',body})});
  await p.goto(B+path);await p.waitForTimeout(300);return p}
(async()=>{const b=await chromium.launch();
 console.log('=== SALES APP ===');
 for(const who of ['sales_non','sales_boss']){
  const p=await open(b,'/sales',390);await p.fill('#loginUser',who+'@mglobalsourcing.net');await p.fill('#loginPass','pw123456');await p.click('#loginBtn');await p.waitForTimeout(1500);
  if(who==='sales_boss')await p.screenshot({path:process.argv[3]+'/v43_sales_boss.png',fullPage:true});
  const r=await p.evaluate(()=>Object.values(S.rows).filter(r=>!r.deleted).map(r=>({no:r.docNo,st:r.status,stage:stageOf(r).key,price:priceShown(r),upd:needsUpdate(r),val:valueOf(r),cur:(r.d&&r.d.header&&r.d.header.currency)||r.currency})));
  console.log(who, JSON.stringify(r));
  console.log('  flagged "ต้องอัปเดต" but price NOT visible:',r.filter(x=>x.upd&&!x.price).map(x=>x.no).join(', ')||'none');
  console.log('  ready KPI money:',await p.evaluate(()=>[...document.querySelectorAll('.kpi')].map(k=>k.innerText.replace(/\n/g,' ')).join(' | ')));
  console.log('  errors:',p._errs.join(';')||'none');
 }
 console.log('\n=== INDEX (internal) ===');
 for(const who of ['gm','admin','procurement','bd','sourcing1']){
  const p=await open(b,'/',1366);await p.fill('#loginUser',who+'@mglobalsourcing.net');await p.fill('#loginPass','pw123456');await p.click('button:has-text("เข้าสู่ระบบ")');await p.waitForTimeout(1800);await p.evaluate(()=>closeModal());
  const routes=await p.evaluate(()=>NAV.filter(n=>n.id&&(!n.perm||perms()[n.perm])).map(n=>n.id));
  const res=[];
  for(const r of routes){await p.evaluate(r=>{closeModal();go(r,true)},r);await p.waitForTimeout(250);
    if(r==='new')await p.evaluate(()=>{editQuote('S1')});await p.waitForTimeout(r==='new'?600:0);
    const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,txt:(document.getElementById('content').innerText||'').trim().length,denied:/Access Restricted/.test(document.getElementById('content').innerText)}));
    res.push(r+(o.denied?'[DENIED]':'')+(o.txt<30?'[EMPTY]':'')+(o.sw>o.iw+1?`[HSCROLL ${o.sw}>${o.iw}]`:''));}
  console.log('   menu shown:',await p.evaluate(()=>[...document.querySelectorAll('#nav .nav-item span')].map(e=>e.textContent).join(' | ')));
  const stale=await p.evaluate(()=>QUOTES.filter(needsSalesUpdate).map(q=>q.docNo+'('+ballOf(q).who+',rel='+(q.releasedTo||[]).length+')'));
  const sum=await p.evaluate(()=>{const l=summaryFiltered();return l.map(q=>q.docNo+':'+q.header.currency+' '+Math.round(quoteTotals(q).total)).join(' ')+' => KPI total '+Math.round(aggregateQuotes(l).total)});
  console.log(who.padEnd(12),res.join('  '));
  console.log('   needsSalesUpdate():',stale.join(', '));
  if(who==='gm')console.log('   summary mixes currencies:',sum);
  console.log('   errors:',p._errs.join(';')||'none');
 }
 for(const w of [1280,1440,1920]){
  const p=await open(b,'/',w);await p.fill('#loginUser','sourcing1');await p.fill('#loginPass','pw123456');await p.click('button:has-text("เข้าสู่ระบบ")');await p.waitForTimeout(1500);
  if(w===1280)console.log('username login w/ correct server pw ->',JSON.stringify(await p.textContent('#loginErr')),' logged in:',await p.evaluate(()=>!!CURRENT));
  await p.waitForTimeout(1000);
  await p.evaluate(()=>{closeModal();editQuote('S1')});await p.waitForTimeout(900);
  const m=await p.evaluate(()=>{const t=document.querySelector('.cost-table'),w=document.getElementById('lineTW'),g=document.querySelector('#content .card .grid');
    return {page:document.documentElement.scrollWidth+'/'+innerWidth,table:t?t.offsetWidth:0,box:w?w.clientWidth:0,
      headerInputs:[...document.querySelectorAll('#content .card:nth-of-type(1) .inp')].map(e=>Math.round(e.getBoundingClientRect().height)).join(','),
      numInputs:document.querySelectorAll('#content input[type=number]').length}});
  console.log('costing@'+w,JSON.stringify(m));
  if(w===1440){await p.screenshot({path:process.argv[3]+'/v43_costing_1440.png'});
    await p.evaluate(()=>{closeModal();go('dashboard',true)});await p.waitForTimeout(500);await p.screenshot({path:process.argv[3]+'/v43_dashboard_1440.png',fullPage:true});}
 }
 await b.close();srv.close();})();
