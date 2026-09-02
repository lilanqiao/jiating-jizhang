/* 家庭记账 · 本地优先 PWA
 * 现阶段：数据存本地(localStorage)，语音→自动分类离线可用(规则引擎)。
 * 预留：creatorId 字段 + LLM 钩子 + 云同步接口，后续接免费云端库即可三人同步。 */

'use strict';

/* ---------------- 家庭成员（可改名/加人，先用默认三人）--------------- */
const MEMBERS = [
  { id: 'a', name: '爸爸', color: '#2c5aa0' },
  { id: 'b', name: '妈妈', color: '#c0397b' },
  { id: 'c', name: '宝贝', color: '#0e7a5f' },
];
const memberById = id => MEMBERS.find(m => m.id === id) || { id:'?', name:'未知', color:'#999' };

/* ---------------- 分类表（带 emoji + 关键词，供自动分类）--------------- */
const CATS = {
  out: [
    { k:'餐饮', e:'🍚', w:['吃','饭','餐','外卖','午饭','晚饭','早饭','早餐','午餐','晚餐','食堂','奶茶','咖啡','零食','水果','买菜','喝','火锅','烧烤','夜宵','请客'] },
    { k:'交通', e:'🚗', w:['打车','地铁','公交','出租','滴滴','高铁','火车','机票','飞机','加油','停车','油费','车费','过路','高速'] },
    { k:'购物', e:'🛍️', w:['买','衣服','鞋','裤','化妆','护肤','淘宝','京东','拼多多','数码','手机','电器','日用','家居','包'] },
    { k:'居住', e:'🏠', w:['房租','水费','电费','燃气','物业','宽带','话费','网费','取暖','房贷'] },
    { k:'娱乐', e:'🎮', w:['电影','游戏','唱歌','ktv','旅游','景点','门票','会员','视频','充值','玩'] },
    { k:'医疗', e:'💊', w:['医院','看病','药','挂号','体检','牙','诊所','医保'] },
    { k:'教育', e:'📚', w:['学费','书','培训','课','报班','文具','学习','补习','幼儿园','学校'] },
    { k:'宝贝', e:'🧸', w:['奶粉','尿布','玩具','童装','儿童','宝宝','辅食','早教'] },
    { k:'人情', e:'🎁', w:['红包','礼金','随礼','送礼','孝敬','给爸','给妈','压岁'] },
    { k:'其他', e:'📦', w:[] },
  ],
  in: [
    { k:'工资', e:'💰', w:['工资','薪水','发工资','月薪','底薪','绩效'] },
    { k:'奖金', e:'🏆', w:['奖金','年终','提成','分红','补贴'] },
    { k:'兼职', e:'💼', w:['兼职','外快','接单','副业','私活'] },
    { k:'理财', e:'📈', w:['利息','收益','基金','股票','理财','分红'] },
    { k:'红包', e:'🧧', w:['红包','收到','转账','还钱','报销'] },
    { k:'其他', e:'📦', w:[] },
  ],
};

/* ---------------- 存储 --------------- */
const LS = {
  get me(){ return localStorage.getItem('jz_me') || ''; },
  set me(v){ localStorage.setItem('jz_me', v); },
  load(){ try{ return JSON.parse(localStorage.getItem('jz_records')||'[]'); }catch{ return []; } },
  save(r){ localStorage.setItem('jz_records', JSON.stringify(r)); },
};
let records = LS.load();

/* ---------------- 工具 --------------- */
const $ = s => document.querySelector(s);
const yuan = n => '¥' + (Math.round(n*100)/100).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2});
const pad = n => String(n).padStart(2,'0');
const ymd = t => { const d=new Date(t); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
function dayLabel(key){
  const today=ymd(Date.now());
  const y=new Date(Date.now()-864e5); const yest=ymd(y.getTime());
  if(key===today) return '今天';
  if(key===yest) return '昨天';
  const d=new Date(key); return `${d.getMonth()+1}月${d.getDate()}日`;
}

/* ---------------- 语音→结构化（离线规则引擎）---------------
 * 从一句话里抽出：金额 / 分类 / 备注。可后续替换为免费 LLM。 */
const CN_DIG = {零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
const CN_UNIT = {十:10,百:100,千:1000,万:10000,亿:100000000};
// 支持「三十八」「一百二」「两千」及口语缩写「三千八=3800」「两百三=230」「一万二=12000」
function cn2num(s){
  if(/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  let total=0, section=0, lastUnit=1, prev=null;
  for(const ch of s){
    if(CN_DIG[ch]!=null){ prev=CN_DIG[ch]; }
    else if(CN_UNIT[ch]!=null){
      const u=CN_UNIT[ch];
      if(u>=10000){ total=(total+section+(prev==null?0:prev))*u; section=0; }
      else { section += (prev==null?1:prev)*u; }
      lastUnit=u; prev=null;
    } else return NaN;
  }
  let r=total+section;
  if(prev!=null){ r += (r>0 && lastUnit>=10) ? prev*(lastUnit/10) : prev; } // 处理「三千八」结尾省略量级
  return r;
}
const COUNTER='张个瓶斤杯份位名口只条次页岁只件套双'; // 避免把「两张/三个」当金额
function extractAmount(text){
  // 阿拉伯数字优先（手机语音输入一般已转阿拉伯数字）
  let m = text.match(/(\d+(?:\.\d{1,2})?)/);
  if(m){ const n=parseFloat(m[1]); if(n>0) return n; }
  // 中文金额：带「块/元」的最可信
  m = text.match(/([零一二两三四五六七八九十百千万亿]+)\s*[块元]/);
  if(m){ const n=cn2num(m[1]); if(n>0) return n; }
  // 无单位的中文数字（≥2字、且后面不是量词）
  const re=new RegExp(`([零一二两三四五六七八九十百千万亿]{2,})(?![${COUNTER}])`,'g');
  let best=null, x;
  while((x=re.exec(text))){ const n=cn2num(x[1]); if(n>0 && (best==null||n>best)) best=n; }
  return best;
}
function guessKind(text){
  const t = text;
  // 明确的收入信号
  const inRe  = /(工资|薪水|薪资|月薪|底薪|绩效|奖金|年终奖|年终|提成|分红|报销|到账|入账|进账|收到|收了|退款|退回|中奖|卖了|卖出|利息|收益|兼职|外快|私活|稿费|奖学金|养老金|低保|发工资|发的工资|发了工资|转入|入账)/;
  // 明确的支出信号（注意“发红包/包红包”是支出）
  const outRe = /(花了|花掉|花销|买|吃|喝|付了|付款|支付|交了|交费|缴|充了|充值|打车|加油|房租|租金|物业|报名|订了|订购|发红包|包红包|随礼|送礼|请客|给了)/;
  const inHit = inRe.test(t), outHit = outRe.test(t);
  if(inHit && !outHit) return 'in';
  if(outHit && !inHit) return 'out';
  // 都没命中时的笼统兜底：说到“收/进/挣/赚”且没说“花/买/付/给”
  if(/(收入|进账|收|挣|赚|得了)/.test(t) && !/(花|买|付|交|给|充|租)/.test(t)) return 'in';
  return 'out';
}
function guessCat(text, kind){
  const list = CATS[kind];
  let best=null, hit=0;
  for(const c of list){
    for(const w of c.w){ if(text.includes(w)){ if(w.length>hit){ hit=w.length; best=c.k; } } }
  }
  return best || list[list.length-1].k; // 兜底“其他”
}
// AI 精简：把「今天中午和同事在楼下川菜馆吃饭花了38」压成「同事吃饭」这样的短备注
const FILLER = ['今天','明天','昨天','前天','刚才','刚刚','早晨','早上','中午','傍晚','晚上','上午','下午',
  '一共','总共','大概','大约','差不多','顺便','然后','接着','那家','那个','这个','一家','附近','楼下','楼上',
  '花了','花掉','用了','付了','付款','支付','交了','充了','收到','进账','发了','得了',
  '我','你','他','她','咱','我们','的','了','在','给','和','跟','与','还','又','就','把','被','帮'];
function condenseNote(text){
  let s = text.replace(/[，,。.!！?？、；;：:～~]/g,' ');
  // 去金额
  s = s.replace(/\d+(?:\.\d{1,2})?\s*(块钱|块|元)?/g,' ')
       .replace(/[零一二两三四五六七八九十百千万亿]+\s*(块钱|块|元)/g,' ');
  for(const f of FILLER) s = s.split(f).join('');
  s = s.replace(/\s+/g,'').trim();
  if(s.length>10) s = s.slice(0,10);
  return s;
}
function parseText(raw){
  const text = (raw||'').trim();
  const kind = guessKind(text);
  const amount = extractAmount(text);
  const cat = guessCat(text, kind);
  let note = condenseNote(text);
  if(note.length < 1) note = cat;   // 精简后空了，就用分类名兜底
  return { kind, amount, cat, note };
}

/* ---------------- 语音识别（Web Speech，可用则用）--------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog=null, recording=false;
function startVoice(){
  const btn=$('#voiceBtn'), hint=$('#hint');
  if(!SR){
    hint.innerHTML = '这台设备的浏览器不支持按住说话，<b>直接用键盘的语音输入</b>把话打进备注即可，一样会自动分类。';
    $('#note').focus();
    return;
  }
  if(recording){ recog && recog.stop(); return; }
  recog = new SR();
  recog.lang='zh-CN'; recog.interimResults=true; recog.continuous=false;
  recording=true; btn.classList.add('rec'); btn.textContent='🔴 松开结束…（正在听）';
  let finalText='';
  recog.onresult = e => {
    let t=''; for(let i=0;i<e.results.length;i++) t+=e.results[i][0].transcript;
    finalText=t; $('#note').value=t;
    const p=parseText(t); applyParse(p, true);
  };
  recog.onerror = ()=>{ hint.innerHTML='没听清，可以再试，或直接打字。'; };
  recog.onend = ()=>{ recording=false; btn.classList.remove('rec'); btn.textContent='🎤 长按说话，自动填好（也可直接打字）';
    if(finalText){ const p=parseText(finalText); applyParse(p, false); } };
  recog.start();
}

/* ---------------- 记账面板状态 --------------- */
let cur = { kind:'out', cat:'', amount:null, note:'' };
function renderCats(){
  const wrap=$('#cats'); wrap.innerHTML='';
  CATS[cur.kind].forEach(c=>{
    const b=document.createElement('button');
    b.className='cat'+(c.k===cur.cat?' act':'');
    b.innerHTML=`<span>${c.e}</span>${c.k}`;
    b.onclick=()=>{ cur.cat=c.k; renderCats(); validate(); };
    wrap.appendChild(b);
  });
}
function applyParse(p, live){
  if(p.amount!=null){ cur.amount=p.amount; $('#amt').value=p.amount; }
  if(p.kind && p.kind!==cur.kind){ cur.kind=p.kind; syncSeg(); }
  cur.cat=p.cat; cur.note=p.note; $('#note').value=$('#note').value||p.note;
  renderCats(); validate();
  if(!live){
    const c=CATS[cur.kind].find(x=>x.k===cur.cat);
    $('#hint').innerHTML = p.amount!=null
      ? `已识别：<b>${cur.kind==='out'?'支出':'收入'} ${yuan(p.amount)} · ${c?c.e:''}${cur.cat}</b>，确认后保存`
      : `已归类到 <b>${cur.cat}</b>，请补一下金额`;
  }
}
function syncSeg(){
  $('#segOut').classList.toggle('act', cur.kind==='out');
  $('#segOut').classList.toggle('out', cur.kind==='out');
  $('#segIn').classList.toggle('act', cur.kind==='in');
  $('#segIn').classList.toggle('in', cur.kind==='in');
  if(!CATS[cur.kind].some(c=>c.k===cur.cat)) cur.cat='';
  renderCats();
}
function validate(){ $('#save').disabled = !(cur.amount>0 && cur.cat); }

/* ---------------- 保存 --------------- */
function saveRecord(){
  const me = LS.me;
  if(!me){ openWho(); return; }
  const amt = parseFloat($('#amt').value);
  if(!(amt>0) || !cur.cat) return;
  const rec = {
    id: Date.now()+'-'+Math.random().toString(36).slice(2,6),
    kind: cur.kind, amount: amt, cat: cur.cat,
    note: $('#note').value.trim() || cur.cat,
    creatorId: me,           // ← 谁记的，自动记录
    ts: Date.now(),
    synced: false,
  };
  records.unshift(rec);
  LS.save(records);
  closeSheet(); render();
  // 云同步：推到 Supabase，成功后标记已同步
  if(window.Sync && Sync.enabled){
    Sync.push(rec).then(ok=>{ if(ok){ rec.synced=true; LS.save(records); } });
  }
}

/* ---------------- 渲染列表 + 月度汇总 --------------- */
function render(){
  const me=LS.me;
  if(me){ const m=memberById(me); $('#whoDot').textContent=m.name[0]; $('#whoDot').style.background=m.color; $('#whoName').textContent=m.name; }
  else { $('#whoName').textContent='选择'; }

  // 本月汇总（全家合计）
  const now=new Date(), mk=`${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  let out=0,inc=0;
  records.forEach(r=>{ if(ymd(r.ts).slice(0,7)===mk){ r.kind==='out'?out+=r.amount:inc+=r.amount; } });
  $('#mOut').textContent=yuan(out); $('#mIn').textContent=yuan(inc);
  $('#mNet').textContent=yuan(inc-out);

  const list=$('#list');
  if(!records.length){ list.innerHTML=`<div class="empty"><div class="big">🪙</div>还没有记账<br>点下面绿色 ＋ 说一句话试试</div>`; return; }
  // 按天分组
  const groups={};
  records.forEach(r=>{ const k=ymd(r.ts); (groups[k]=groups[k]||[]).push(r); });
  let html='';
  Object.keys(groups).sort().reverse().forEach(k=>{
    const arr=groups[k];
    let dOut=0,dIn=0; arr.forEach(r=>r.kind==='out'?dOut+=r.amount:dIn+=r.amount);
    html+=`<div class="daygroup"><div class="dayhead"><span>${dayLabel(k)}</span><span>${dIn?'收 '+yuan(dIn)+'　':''}支 ${yuan(dOut)}</span></div>`;
    arr.forEach(r=>{
      const c=CATS[r.kind].find(x=>x.k===r.cat)||{e:'📦'};
      const p=memberById(r.creatorId);
      html+=`<div class="item" data-id="${r.id}">
        <div class="emoji">${c.e}</div>
        <div class="mid"><div class="note">${esc(r.note)}</div>
          <div class="meta"><span class="pill">${r.cat}</span>
          <span class="pill person" style="background:${hex2rgba(p.color,.12)};color:${p.color}">${p.name}</span>
          <span>${new Date(r.ts).getHours()}:${pad(new Date(r.ts).getMinutes())}</span></div>
        </div>
        <div class="amt ${r.kind==='in'?'in':'out'}">${r.kind==='in'?'+':'-'}${yuan(r.amount)}</div>
      </div>`;
    });
    html+='</div>';
  });
  list.innerHTML=html;
  // 长按删除
  list.querySelectorAll('.item').forEach(el=>{
    let timer;
    const start=()=>{ timer=setTimeout(()=>{ if(confirm('删除这条记录？')){ const id=el.dataset.id; records=records.filter(r=>r.id!==id); LS.save(records); render(); if(window.Sync&&Sync.enabled) Sync.remove(id); } },550); };
    const cancel=()=>clearTimeout(timer);
    el.addEventListener('touchstart',start,{passive:true}); el.addEventListener('touchend',cancel);
    el.addEventListener('mousedown',start); el.addEventListener('mouseup',cancel); el.addEventListener('mouseleave',cancel);
  });
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function hex2rgba(h,a){ const n=parseInt(h.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }

/* ---------------- 弹层控制 --------------- */
function openSheet(){
  cur={kind:'out',cat:'',amount:null,note:''};
  $('#amt').value=''; $('#note').value=''; $('#save').disabled=true;
  $('#hint').innerHTML='例：中午吃饭花了 38 &nbsp;·&nbsp; 发工资 8000';
  syncSeg();
  $('#mask').classList.add('on'); $('#sheet').classList.add('on');
}
function closeSheet(){ $('#mask').classList.remove('on'); $('#sheet').classList.remove('on'); }
function openWho(){
  const box=$('#people'); box.innerHTML='';
  MEMBERS.forEach(m=>{
    const row=document.createElement('button'); row.className='person-row';
    row.innerHTML=`<span class="dot" style="background:${m.color}">${m.name[0]}</span><b>${m.name}</b>`;
    row.onclick=()=>{ LS.me=m.id; $('#mask2').classList.remove('on'); $('#sheet2').classList.remove('on'); render(); };
    box.appendChild(row);
  });
  $('#mask2').classList.add('on'); $('#sheet2').classList.add('on');
}

/* ---------------- 事件绑定 --------------- */
$('#fab').onclick=()=>{ if(!LS.me){ openWho(); } else openSheet(); };
$('#mask').onclick=closeSheet;
$('#whoBtn').onclick=openWho;
$('#mask2').onclick=()=>{ if(LS.me){ $('#mask2').classList.remove('on'); $('#sheet2').classList.remove('on'); } };
$('#segOut').onclick=()=>{ cur.kind='out'; syncSeg(); validate(); };
$('#segIn').onclick=()=>{ cur.kind='in'; syncSeg(); validate(); };
$('#voiceBtn').onclick=startVoice;
$('#amt').oninput=e=>{ cur.amount=parseFloat(e.target.value); validate(); };
$('#note').oninput=e=>{ const t=e.target.value; cur.note=t; const p=parseText(t); if(p.amount!=null && !$('#amt').value){ $('#amt').value=p.amount; cur.amount=p.amount; } if(p.kind && p.kind!==cur.kind){ cur.kind=p.kind; syncSeg(); } cur.cat=p.cat; renderCats(); validate(); };
$('#save').onclick=saveRecord;

/* ---------------- 启动 --------------- */
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
render();
if(!LS.me) setTimeout(openWho, 400);

/* ---------------- 云同步启动 --------------- */
async function refreshFromServer(){
  const server = await Sync.pull();
  if(!server) return;
  const map = new Map(server.map(r=>[r.id, r]));
  // 保留本地还没推上去的（离线记的）
  records.filter(r=>!r.synced).forEach(r=>{ if(!map.has(r.id)) map.set(r.id, r); });
  records = Array.from(map.values()).sort((a,b)=>b.ts-a.ts);
  LS.save(records); render();
}
async function syncBoot(){
  if(!(window.Sync && Sync.init())) return;   // 未配置则单机运行
  // 先把离线期间记的补推上去
  for(const r of records.filter(r=>!r.synced)){ if(await Sync.push(r)) r.synced=true; }
  LS.save(records);
  await refreshFromServer();                   // 拉全家最新
  Sync.subscribe(refreshFromServer);           // 别人记账时实时刷新
}
syncBoot();
