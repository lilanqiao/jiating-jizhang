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

/* 身份权限：宝贝只看自己记的账;爸爸妈妈都是家长,各自手机默认看全家。 */
const RESTRICTED = new Set(['c']);
const isRestricted = () => RESTRICTED.has(LS.me);
/* 「看谁」筛选:只家长用,只改本机当前显示范围(不同步/不改身份)。'all'=全家,或某人creatorId。 */
let viewFilter = 'all';
const visibleRecords = () => {
  if(isRestricted()) return records.filter(r => r.creatorId === LS.me);   // 宝贝:锁死只看自己
  return viewFilter==='all' ? records : records.filter(r => r.creatorId === viewFilter);
};
let _toastT;
function showToast(msg){ const t=document.getElementById('toast'); if(!t) return; t.textContent=msg; t.classList.add('on'); clearTimeout(_toastT); _toastT=setTimeout(()=>t.classList.remove('on'),2200); }

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
    { k:'奖金', e:'🏆', w:['奖金','年终','提成','分红','补贴','奖励','奖状'] },
    { k:'兼职', e:'💼', w:['兼职','外快','接单','副业','私活'] },
    { k:'理财', e:'📈', w:['利息','收益','基金','股票','理财','分红'] },
    { k:'红包', e:'🧧', w:['红包','收到','转账','还钱','报销','零花钱','零用钱','压岁钱'] },
    { k:'其他', e:'📦', w:[] },
  ],
};

/* ---------------- 存储 --------------- */
const LS = {
  get me(){ return localStorage.getItem('jz_me') || ''; },
  set me(v){ localStorage.setItem('jz_me', v); },
  // 宝贝专用机：本机标记(不同步)。开了=这台是女儿的机子,锁定宝贝,切换需家长密码。
  get kidLock(){ return localStorage.getItem('jz_kidlock') || ''; },
  set kidLock(v){ v ? localStorage.setItem('jz_kidlock', '1') : localStorage.removeItem('jz_kidlock'); },
  get kidPin(){ return localStorage.getItem('jz_kidpin') || ''; },
  set kidPin(v){ localStorage.setItem('jz_kidpin', v); },
  load(){ try{ return JSON.parse(localStorage.getItem('jz_records')||'[]'); }catch{ return []; } },
  save(r){ localStorage.setItem('jz_records', JSON.stringify(r)); },
};
/* 锁只认「这台是不是宝贝专用机」,不认屏幕上当前是谁——家长手机永不锁。 */
const isLocked = () => LS.kidLock === '1';
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
// 数量：两份/2份/三个…
function extractQuantity(text){
  const m = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*(份|个|张|瓶|杯|斤|件|双|盒|包|次|本|台|部)/);
  if(m){ const q = /^[0-9]+$/.test(m[1]) ? parseInt(m[1],10) : cn2num(m[1]); if(q>1) return q; }
  return null;
}
// 单价：一份199 / 每份199 / 每个35 / 单价199（数字须紧跟在“每X/单价/一份”之后）
function extractUnitPrice(text){
  const m = text.match(/(?:每|单价|一)\s*(?:份|个|张|瓶|杯|盒|本|台|部|件|双)?\s*(\d+(?:\.\d{1,2})?)/);
  if(m){ const p = parseFloat(m[1]); if(p>0) return p; }
  return null;
}
function extractAmount(text){
  // 数量 × 单价：如「卖了两份，一份199」→ 398
  const qty = extractQuantity(text), unit = extractUnitPrice(text);
  if(qty && unit) return Math.round(qty * unit * 100) / 100;
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
  const inRe  = /(工资|薪水|薪资|月薪|底薪|绩效|奖金|年终奖|年终|提成|分红|报销|到账|入账|进账|收到|收了|退款|退回|中奖|卖了|卖出|利息|收益|兼职|外快|私活|稿费|奖学金|养老金|低保|发工资|发的工资|发了工资|转入|入账|零花钱|零用钱|压岁钱|奖励)/;   // 后4个=孩子收钱常见词
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
  // 先去数量词（两份/一份/3个/两瓶…），避免标题里留断头的“两份…一份”
  s = s.replace(/(\d+|[一二两三四五六七八九十]+)\s*(份|个|张|瓶|杯|斤|件|双|盒|包|次|本|台|部|条|只|碗|袋|箱|套|块|杯)/g,' ');
  // 再去金额
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
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && (navigator.maxTouchPoints||0)>1);
const IS_STANDALONE = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
const IOS_APP = IS_IOS && IS_STANDALONE;   // 苹果“加到桌面”后网页语音被系统禁用，改用系统键盘听写
let recog=null, recording=false;
function voiceIdleLabel(){
  return SR ? '🎤 点一下说话，说完再点一下结束' : '⌨️ 点这里→用键盘上的话筒 🎤 说话';
}
function keyboardTip(prefix){
  $('#hint').innerHTML = (prefix||'👉 ') + '点开下面的「<b>备注</b>」框，再点手机<b>键盘上的话筒 🎤</b> 说话，说完一样自动填好。';
  $('#note').focus();
}
function endVoice(){ recording=false; const b=$('#voiceBtn'); b.classList.remove('rec'); b.textContent=voiceIdleLabel(); }
function startVoice(){
  const btn=$('#voiceBtn');
  // 先真的尝试网页语音「点一下说话」；只有本机确实不给录音(下面 catch/onerror)才退回键盘
  if(!SR){ keyboardTip(); return; }                 // 浏览器完全不支持语音
  if(recording){ recog && recog.stop(); return; }   // 再点一下 = 结束说话
  try { recog = new SR(); } catch(e){ keyboardTip('这台设备不让网页直接录音，'); return; }
  recog.lang='zh-CN'; recog.interimResults=true; recog.continuous=false;
  let finalText='';
  recording=true; btn.classList.add('rec'); btn.textContent='🔴 正在听…（说完点我结束）';
  recog.onresult = e => {
    let t=''; for(let i=0;i<e.results.length;i++) t+=e.results[i][0].transcript;
    finalText=t; $('#note').value=t; applyParse(parseText(t), true);
  };
  recog.onerror = () => { endVoice(); keyboardTip('这台设备不让网页直接录音，'); };  // 苹果加桌面后常见
  recog.onend   = () => { endVoice(); if(finalText) applyParse(parseText(finalText), false); };
  try { recog.start(); } catch(e){ endVoice(); keyboardTip('这台设备不让网页直接录音，'); }
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
let editingRecordId = null;
function saveRecord(){
  const me = LS.me;
  if(!me){ openWho(); return; }
  const amt = parseFloat($('#amt').value);
  if(!(amt>0) || !cur.cat) return;
  const rawText = $('#note').value.trim();
  const shortNote = (condenseNote(rawText) || cur.cat).slice(0, 12); // 列表显示的精简标题
  let rec;
  if(editingRecordId){                                   // 编辑已有记录：备注你填啥就是啥，不再自动精简
    rec = records.find(r=>r.id===editingRecordId);
    if(rec){ rec.kind=cur.kind; rec.amount=amt; rec.cat=cur.cat;
      rec.note=(rawText || cur.cat).slice(0,20); rec.noCount=$('#noCount').checked; rec.synced=false; }
      // rec.raw（当时说的原话）保持不变
  } else {                                               // 新记录
    rec = {
      id: Date.now()+'-'+Math.random().toString(36).slice(2,6),
      kind: cur.kind, amount: amt, cat: cur.cat,
      note: shortNote, raw: rawText || shortNote,
      creatorId: me, ts: Date.now(),
      noCount: $('#noCount').checked, synced: false,
    };
    records.unshift(rec);
  }
  LS.save(records);
  closeSheet(); render();
  if(rec && window.Sync && Sync.enabled){
    Sync.push(rec).then(ok=>{ if(ok){ rec.synced=true; LS.save(records); } });
  }
}
function openEditSheet(rec){
  editingRecordId = rec.id;
  cur = { kind:rec.kind, cat:rec.cat, amount:rec.amount, note:rec.note };
  $('#amt').value = rec.amount; $('#note').value = rec.note;   // 编辑时显示短标题，方便直接改
  $('#noCount').checked = !!rec.noCount;
  $('#hint').innerHTML = '备注可直接改，改好点保存（原话仍保留在详情里）';
  $('#sheet').querySelector('h3').textContent = '编辑这一笔';
  $('#save').textContent = '保存修改';
  syncSeg(); renderCats(); validate();
  $('#mask').classList.add('on'); $('#sheet').classList.add('on');
}

/* ---------------- 列表条目 helper --------------- */
const isFixed = r => String(r.id).startsWith('recur-');   // 定期自动生成的固定支出
function itemHTML(r){
  const c=CATS[r.kind].find(x=>x.k===r.cat)||{e:'📦'};
  const p=memberById(r.creatorId); const nc=r.noCount;
  return `<div class="item" data-id="${r.id}">
    <div class="emoji">${nc?'↩️':c.e}</div>
    <div class="mid"><div class="note">${esc(r.note)}</div>
      <div class="meta">${nc?'<span class="pill nocount">不计入</span>':`<span class="pill">${r.cat}</span>`}
      <span class="pill person" style="background:${hex2rgba(p.color,.12)};color:${p.color}">${p.name}</span>
      <span>${new Date(r.ts).getHours()}:${pad(new Date(r.ts).getMinutes())}</span></div>
    </div>
    <div class="amt ${nc?'nocount':(r.kind==='in'?'in':'out')}">${r.kind==='in'?'+':'-'}${yuan(r.amount)}</div>
  </div>`;
}
function bindItems(container){
  container.querySelectorAll('.item').forEach(el=>{ el.onclick=()=>{ const r=records.find(x=>x.id===el.dataset.id); if(r) openDetail(r); }; });
}

/* ---------------- 渲染列表 + 月度汇总 --------------- */
function render(){
  const me=LS.me;
  if(me){ const m=memberById(me); $('#whoDot').textContent=m.name[0]; $('#whoDot').style.background=m.color; $('#whoName').textContent=m.name; }
  else { $('#whoName').textContent='选择'; }

  // 「看谁」筛选条：只家长显示，宝贝不显示（它只能看自己）
  renderFilterBar();
  // 可见范围：家长看全家(可再筛某人)；宝贝只看自己的
  const view = visibleRecords();
  // 本月汇总
  const now=new Date(), mk=`${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  let out=0,inc=0;
  view.forEach(r=>{ if(!r.noCount && ymd(r.ts).slice(0,7)===mk){ r.kind==='out'?out+=r.amount:inc+=r.amount; } });
  $('#mOut').textContent=yuan(out); $('#mIn').textContent=yuan(inc);
  $('#mNet').textContent=yuan(inc-out);

  const list=$('#list');
  if(!view.length){ list.innerHTML=`<div class="empty"><div class="big">🪙</div>还没有记账<br>点下面绿色 ＋ 说一句话试试</div>`; return; }

  let html='';
  // 固定支出不铺进主页（去 ⏱ 周期记账 里看），但仍计入本月总支出
  const daily = view.filter(r=>!isFixed(r));
  const groups={};
  daily.forEach(r=>{ const k=ymd(r.ts); (groups[k]=groups[k]||[]).push(r); });
  Object.keys(groups).sort().reverse().forEach(k=>{
    const arr=groups[k];
    let dOut=0,dIn=0; arr.forEach(r=>{ if(!r.noCount){ r.kind==='out'?dOut+=r.amount:dIn+=r.amount; } });
    html+=`<div class="daygroup"><div class="dayhead"><span>${dayLabel(k)}</span><span>${dIn?'收 '+yuan(dIn)+'　':''}支 ${yuan(dOut)}</span></div>`;
    arr.forEach(r=>{ html+=itemHTML(r); });
    html+='</div>';
  });
  list.innerHTML=html;
  bindItems(list);
}
/* 「看谁」筛选条：全家/爸爸/妈妈/宝贝，只家长可见，只筛显示不改身份 */
function renderFilterBar(){
  const bar=$('#filterBar'); if(!bar) return;
  if(isRestricted() || !LS.me){ bar.hidden=true; bar.innerHTML=''; return; }
  bar.hidden=false;
  // 顺序：妈妈·爸爸·宝贝·全家(全家放最后)
  const opts=[...['b','a','c'].map(memberById), {id:'all',name:'全家'}];
  bar.innerHTML = opts.map(o=>`<button class="fchip${viewFilter===o.id?' on':''}" data-f="${o.id}">${o.name}</button>`).join('');
  bar.querySelectorAll('.fchip').forEach(b=> b.onclick=()=>{ viewFilter=b.dataset.f; render(); });
}
/* 通用明细弹层：固定支出、某人明细都用它 */
function openListSheet(title, recs){
  $('#listSheetTitle').textContent=title;
  const body=$('#listSheetBody');
  body.innerHTML = recs.length ? recs.slice().sort((a,b)=>b.ts-a.ts).map(itemHTML).join('') : '<div class="stat-empty">没有记录</div>';
  bindItems(body);
  $('#mask6').classList.add('on'); $('#sheet6').classList.add('on');
}
function closeListSheet(){ $('#mask6').classList.remove('on'); $('#sheet6').classList.remove('on'); }

/* ---------------- 详情页 --------------- */
function openDetail(rec){
  const c=CATS[rec.kind].find(x=>x.k===rec.cat)||{e:'📦'};
  const p=memberById(rec.creatorId);
  const d=new Date(rec.ts);
  const dt=`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('#detailBody').innerHTML =
    `<div class="dAmt ${rec.kind==='in'?'in':'out'}">${rec.kind==='in'?'+':'-'}${yuan(rec.amount)}</div>
     <div class="dRow"><span>类型</span><b>${rec.kind==='in'?'收入':'支出'}</b></div>
     <div class="dRow"><span>分类</span><b>${c.e} ${rec.cat}</b></div>
     <div class="dRow"><span>记账人</span><b>${p.name}</b></div>
     <div class="dRow"><span>时间</span><b>${dt}</b></div>
     ${rec.noCount?'<div class="dRow"><span>统计</span><b style="color:#888">↩️ 不计入收支</b></div>':''}
     <div class="dRaw"><div class="dRawLabel">当时说的话</div><div class="dRawText">${esc(rec.raw||rec.note)}</div></div>`;
  $('#detailEdit').onclick=()=>{ closeDetail(); openEditSheet(rec); };
  $('#detailDel').onclick=()=>{
    if(confirm('删除这一笔？')){
      records=records.filter(r=>r.id!==rec.id); LS.save(records);
      if(window.Sync&&Sync.enabled) Sync.remove(rec.id);
      closeDetail(); render();
    }
  };
  $('#mask3').classList.add('on'); $('#sheet3').classList.add('on');
}
function closeDetail(){ $('#mask3').classList.remove('on'); $('#sheet3').classList.remove('on'); }
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function hex2rgba(h,a){ const n=parseInt(h.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }

/* ---------------- 弹层控制 --------------- */
function openSheet(){
  editingRecordId=null;
  cur={kind:'out',cat:'',amount:null,note:''};
  $('#amt').value=''; $('#note').value=''; $('#save').disabled=true; $('#noCount').checked=false;
  $('#hint').innerHTML='例：中午吃饭花了 38 &nbsp;·&nbsp; 发工资 8000';
  $('#sheet').querySelector('h3').textContent='记一笔'; $('#save').textContent='保存';
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
  // 宝贝专用机：只在女儿手机上点一次(做成不起眼的小字链接,别像个成员)。锁定后固定宝贝,切换需家长4位密码。
  const lock=document.createElement('button'); lock.className='linkbtn';
  lock.style.cssText='display:block;margin:16px auto 2px;text-align:center';
  lock.textContent='🔒 把这台设为女儿的专用机';
  lock.onclick=()=>{
    if(!confirm('要把这台设成女儿的专用机吗？\n锁定后固定为宝贝，切换需要4位家长密码。\n（在你自己手机上不要设这个。）')) return;
    const p1=prompt('设一个4位家长密码（以后解锁用）：'); if(p1==null) return;
    if(!/^\d{4}$/.test(p1)){ showToast('要4位数字'); return; }
    if(prompt('再输一次确认：')!==p1){ showToast('两次不一致'); return; }
    LS.kidPin=p1; LS.kidLock=true; LS.me='c';
    $('#mask2').classList.remove('on'); $('#sheet2').classList.remove('on'); render();
    showToast('已锁定为宝贝专用机');
  };
  box.appendChild(lock);
  $('#mask2').classList.add('on'); $('#sheet2').classList.add('on');
}

/* ---------------- 周期记账（自动定期记上，防漏） --------------- */
const REC = {
  load(){ try{ return JSON.parse(localStorage.getItem('jz_recurring')||'[]'); }catch{ return []; } },
  save(v){ localStorage.setItem('jz_recurring', JSON.stringify(v)); },
};
let recurDefs = REC.load();
let rForm = { kind:'out', period:'monthly' };

// 到点自动补记（支持漏开几期后一次性补齐），已生成的用确定性id去重
function runRecurring(){
  const now = new Date(); let added=false; const have=new Set(records.map(r=>r.id));
  for(const d of recurDefs){
    const start = new Date(d.startTs || now.getTime());
    if(d.period==='monthly'){
      // 固定月支出：只要进入了这个月就立即计入（不等到扣费日），记在扣费日那天
      let y=start.getFullYear(), m=start.getMonth();
      for(let i=0;i<24;i++){
        const monthFirst=new Date(y, m, 1, 0,0,0);
        if(now>=monthFirst){
          const due=new Date(y, m, Math.min(d.day,28), 0,0,0);
          const key=`${y}${pad(m+1)}`, id=`recur-${d.id}-${key}`;
          if(!have.has(id)){ pushRecur(d,id,due.getTime()); added=true; }
        }
        m++; if(m>11){m=0;y++;} if(new Date(y,m,1)>now) break;
      }
    } else { // yearly
      let y=start.getFullYear();
      for(let i=0;i<5;i++){
        const due=new Date(y, (d.month||1)-1, Math.min(d.day,28), 0,0,0);
        if(due>=start && now>=due){
          const id=`recur-${d.id}-${y}`;
          if(!have.has(id)){ pushRecur(d,id,due.getTime()); added=true; }
        }
        y++; if(new Date(y,0,1)>now) break;
      }
    }
  }
  if(added){ LS.save(records); }
  return added;
}
function pushRecur(d, id, ts){
  const rec={ id, kind:d.kind, amount:d.amount, cat:d.cat, note:d.name, raw:d.name+'（定期自动）',
    creatorId:d.creatorId, ts, noCount:false, synced:false };
  records.unshift(rec);
  if(window.Sync && Sync.enabled) Sync.push(rec).then(ok=>{ if(ok){ rec.synced=true; LS.save(records); } });
}

function openRecurring(){
  $('#recurForm').hidden=true; renderRecurList();
  $('#mask4').classList.add('on'); $('#sheet4').classList.add('on');
}
function closeRecurring(){ $('#mask4').classList.remove('on'); $('#sheet4').classList.remove('on'); }
function schedText(d){
  const t=d.kind==='in'?'收':'支';
  return d.period==='monthly' ? `每月${d.day}号 · ${t}${d.cat}` : `每年${d.month}月${d.day}号 · ${t}${d.cat}`;
}
function renderRecurList(){
  const box=$('#recurList');
  // 家长看全家的定期；宝贝只看自己的
  const defs = isRestricted() ? recurDefs.filter(d=>d.creatorId===LS.me) : recurDefs;
  if(!defs.length){ box.innerHTML='<div class="recur-empty">还没有定期项目，点下面添加</div>'; return; }
  // 本月固定支出合计（可见范围内）
  const mk=`${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`;
  let sum=0; visibleRecords().forEach(r=>{ if(isFixed(r) && !r.noCount && r.kind==='out' && ymd(r.ts).slice(0,7)===mk) sum+=r.amount; });
  box.innerHTML=`<div class="fixedbar" style="cursor:default"><div><div class="fb-t">🔒 本月固定支出合计</div><div class="fb-s">已自动记入，算进主页“本月支出”</div></div><div class="fb-r">${yuan(sum)}</div></div>`;
  defs.forEach(d=>{
    const row=document.createElement('div'); row.className='recur-item';
    row.innerHTML=`<div class="ri-body"><div class="ri-main">${esc(d.name)} ${yuan(d.amount)}</div><div class="ri-sub">${schedText(d)} · 点这里改</div></div><button class="ri-del">删除</button>`;
    row.querySelector('.ri-body').onclick=()=>openRecurForm(d);   // 点项目 → 编辑
    row.querySelector('.ri-del').onclick=()=>{ if(confirm('删除这个定期项目？(已生成的记录保留)')){ recurDefs=recurDefs.filter(x=>x.id!==d.id); REC.save(recurDefs); if(window.Sync&&Sync.enabled) Sync.removeDef(d.id); renderRecurList(); } };
    box.appendChild(row);
  });
}
function fillRecurCats(){
  const sel=$('#rCat'); sel.innerHTML='';
  CATS[rForm.kind].forEach(c=>{ const o=document.createElement('option'); o.value=c.k; o.textContent=`${c.e} ${c.k}`; sel.appendChild(o); });
}
function initRecurSelects(){
  const md=$('#rMonth'); if(md && !md.options.length){ for(let i=1;i<=12;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i+'月'; md.appendChild(o);} }
  const dd=$('#rDay'); if(dd && !dd.options.length){ for(let i=1;i<=28;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i+'号'; dd.appendChild(o);} }
}
let editingRecurId = null;
function openRecurForm(def){
  def = (def && def.id) ? def : null;        // 有传项目=编辑，没传=新增
  editingRecurId = def ? def.id : null;
  rForm = { kind: def?def.kind:'out', period: def?def.period:'monthly' };
  initRecurSelects(); fillRecurCats();
  // 收/支段
  $('#rSegOut').classList.toggle('act', rForm.kind==='out'); $('#rSegOut').classList.toggle('out', rForm.kind==='out');
  $('#rSegIn').classList.toggle('act', rForm.kind==='in');  $('#rSegIn').classList.toggle('in', rForm.kind==='in');
  // 每月/每年段
  $('#rMonthly').classList.toggle('act', rForm.period==='monthly');
  $('#rYearly').classList.toggle('act', rForm.period==='yearly');
  $('#rMonthWrap').hidden = rForm.period!=='yearly';
  $('#rName').value = def?def.name:'';
  $('#rAmt').value  = def?def.amount:'';
  $('#rDay').value  = def?String(def.day):'1';
  $('#rMonth').value= def&&def.month?String(def.month):'1';
  if(def) $('#rCat').value = def.cat;         // 选项已按kind填好，再定位
  $('#rSave').textContent = def ? '保存修改' : '保存这个定期项目';
  $('#recurForm').hidden=false;
}
function saveRecurDef(){
  const name=$('#rName').value.trim(), amt=parseFloat($('#rAmt').value);
  if(!name){ alert('填一下名称，比如“话费”'); return; }
  if(!(amt>0)){ alert('填一下金额'); return; }
  const fields={ name, amount:amt, kind:rForm.kind, cat:$('#rCat').value, period:rForm.period,
    day:parseInt($('#rDay').value,10), month:parseInt($('#rMonth').value||'1',10) };
  let savedDef;
  if(editingRecurId){                          // 编辑：只改未来，已生成的记录不变
    savedDef=recurDefs.find(x=>x.id===editingRecurId); if(savedDef) Object.assign(savedDef, fields);
  } else {
    savedDef=Object.assign({ id:Date.now()+'-'+Math.random().toString(36).slice(2,5),
      creatorId:LS.me||'a', startTs:Date.now() }, fields);
    recurDefs.push(savedDef);
  }
  REC.save(recurDefs);
  if(savedDef && window.Sync && Sync.enabled) Sync.pushDef(savedDef);   // 设定同步到云端
  runRecurring(); render();
  $('#recurForm').hidden=true; renderRecurList();
}

/* ---------------- 统计（月度/年度 · 花在哪 · 谁花的） --------------- */
let statState = { mode:'month', y:0, m:0 };
function openStats(){ const n=new Date(); statState={mode:'month', y:n.getFullYear(), m:n.getMonth()}; renderStats(); $('#mask5').classList.add('on'); $('#sheet5').classList.add('on'); }
function closeStats(){ $('#mask5').classList.remove('on'); $('#sheet5').classList.remove('on'); }
function statInRange(r){ const d=new Date(r.ts);
  return statState.mode==='month' ? (d.getFullYear()===statState.y && d.getMonth()===statState.m) : (d.getFullYear()===statState.y); }
function renderStats(){
  $('#statTitle').textContent = statState.mode==='month' ? `${statState.y}年${statState.m+1}月` : `${statState.y}年`;
  $('#statMonthBtn').classList.toggle('act', statState.mode==='month');
  $('#statYearBtn').classList.toggle('act', statState.mode==='year');
  const rs = visibleRecords().filter(r=>!r.noCount && statInRange(r));
  let out=0, inc=0; const catMap={}, perMap={};
  rs.forEach(r=>{
    if(r.kind==='out'){ out+=r.amount; catMap[r.cat]=(catMap[r.cat]||0)+r.amount; } else inc+=r.amount;
    const pm=perMap[r.creatorId]||(perMap[r.creatorId]={out:0,inc:0});
    r.kind==='out'?pm.out+=r.amount:pm.inc+=r.amount;
  });
  $('#stOut').textContent=yuan(out); $('#stIn').textContent=yuan(inc); $('#stNet').textContent=yuan(inc-out);
  const cats=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
  $('#statCats').innerHTML = !cats.length ? '<div class="stat-empty">这个时段还没有支出</div>' :
    cats.map(([cat,amt])=>{ const c=CATS.out.find(x=>x.k===cat)||{e:'📦'}; const pct=out?Math.round(amt/out*100):0;
      return `<div class="catbar"><div class="cb-top"><span>${c.e} ${cat}</span><span>${yuan(amt)} · ${pct}%</span></div><div class="cb-track"><div class="cb-fill" style="width:${pct}%"></div></div></div>`;
    }).join('');
  // 家长看全部成员；宝贝只看自己
  const showMembers = isRestricted() ? MEMBERS.filter(m=>m.id===LS.me) : MEMBERS;
  $('#statPeople').innerHTML = showMembers.map(m=>{ const s=perMap[m.id]||{out:0,inc:0};
    return `<div class="pstat" data-uid="${m.id}"><div class="pn"><span class="dot" style="background:${m.color}">${m.name[0]}</span>${m.name}</div><div class="pv">支 ${yuan(s.out)}　收 ${yuan(s.inc)} ›</div></div>`;
  }).join('');
  // 点某个人 → 看他这个时段的明细
  $('#statPeople').querySelectorAll('.pstat').forEach(el=>{
    el.onclick=()=>{ const uid=el.dataset.uid; const m=memberById(uid);
      openListSheet(`${m.name}的明细`, visibleRecords().filter(r=>!r.noCount && r.creatorId===uid && statInRange(r))); };
  });
}
function statStep(dir){
  if(statState.mode==='month'){ statState.m+=dir; if(statState.m<0){statState.m=11;statState.y--;} if(statState.m>11){statState.m=0;statState.y++;} }
  else statState.y+=dir;
  renderStats();
}

/* ---------------- 事件绑定 --------------- */
$('#statBtn').onclick=openStats; $('#summary').onclick=openStats;
$('#mask5').onclick=closeStats; $('#statClose')?.addEventListener('click', closeStats);
$('#mask6').onclick=closeListSheet;
$('#statPrev').onclick=()=>statStep(-1);
$('#statNext').onclick=()=>statStep(1);
$('#statMonthBtn').onclick=()=>{ statState.mode='month'; renderStats(); };
$('#statYearBtn').onclick=()=>{ statState.mode='year'; renderStats(); };
$('#recurBtn').onclick=openRecurring;
$('#mask4').onclick=closeRecurring;
$('#recurAddBtn').onclick=()=>openRecurForm();
$('#rSegOut').onclick=()=>{ rForm.kind='out'; $('#rSegOut').classList.add('act','out'); $('#rSegIn').classList.remove('act','in'); fillRecurCats(); };
$('#rSegIn').onclick=()=>{ rForm.kind='in'; $('#rSegIn').classList.add('act','in'); $('#rSegOut').classList.remove('act','out'); fillRecurCats(); };
$('#rMonthly').onclick=()=>{ rForm.period='monthly'; $('#rMonthly').classList.add('act'); $('#rYearly').classList.remove('act'); $('#rMonthWrap').hidden=true; };
$('#rYearly').onclick=()=>{ rForm.period='yearly'; $('#rYearly').classList.add('act'); $('#rMonthly').classList.remove('act'); $('#rMonthWrap').hidden=false; };
$('#rSave').onclick=saveRecurDef;

$('#fab').onclick=()=>{ if(!LS.me){ openWho(); } else openSheet(); };
$('#mask').onclick=closeSheet;
// 头像：家长手机随时切换；宝贝专用机锁定,解锁需家长4位密码(替代iOS上失灵的长按)
$('#whoBtn').onclick=()=>{
  if(!isLocked()){ openWho(); return; }
  const pin=prompt('家长密码（4位）解锁：'); if(pin==null) return;
  if(pin===LS.kidPin){ LS.kidLock=false; showToast('已解锁'); openWho(); }
  else showToast('密码不对');
};
$('#mask2').onclick=()=>{ if(LS.me){ $('#mask2').classList.remove('on'); $('#sheet2').classList.remove('on'); } };
$('#mask3').onclick=closeDetail;
$('#segOut').onclick=()=>{ cur.kind='out'; syncSeg(); validate(); };
$('#segIn').onclick=()=>{ cur.kind='in'; syncSeg(); validate(); };
$('#voiceBtn').onclick=startVoice;
$('#voiceBtn').textContent = voiceIdleLabel();  // 支持语音就显示“点一下说话”，否则引导键盘话筒
$('#amt').oninput=e=>{ cur.amount=parseFloat(e.target.value); validate(); };
$('#note').oninput=e=>{ const t=e.target.value; cur.note=t;
  if(editingRecordId){ validate(); return; }   // 编辑时尊重你手动，不自动改分类/金额/收支
  const p=parseText(t); if(p.amount!=null && !$('#amt').value){ $('#amt').value=p.amount; cur.amount=p.amount; } if(p.kind && p.kind!==cur.kind){ cur.kind=p.kind; syncSeg(); } cur.cat=p.cat; renderCats(); validate(); };
$('#save').onclick=saveRecord;

/* ---------------- 启动 --------------- */
/* 强力自动更新：绕过iOS的缓存顽疾。每次打开都问服务器版本号，
   有新版就清缓存+注销SW+刷新，桌面App从此不会再卡旧版。 */
const APP_VERSION = 32;
let _updating=false;
function checkUpdate(){
  if(_updating) return;
  try{
    fetch('version.json?_='+Date.now(), {cache:'no-store'})
      .then(r=>r.json())
      .then(d=>{
        if(d && d.v && d.v > APP_VERSION){
          _updating=true;
          Promise.all([
            (self.caches&&caches.keys)?caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k)))):Promise.resolve(),
            navigator.serviceWorker?navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))):Promise.resolve()
          ]).catch(()=>{}).then(()=>{
            // 关键：带版本号跳转，绕过 iOS 对网页文件的10分钟缓存，强制拉最新
            location.replace(location.pathname + '?v=' + d.v);
          });
        }
      }).catch(()=>{});
  }catch(e){}
}
checkUpdate();
// iOS 独立App"重新点开"常是唤醒旧页面、不重新加载→切回前台时再查一次版本
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkUpdate(); });
window.addEventListener('pageshow', e=>{ if(e.persisted) checkUpdate(); });
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(reg=>{
    reg.addEventListener('updatefound', ()=>{
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', ()=>{
        if(nw.state==='installed' && navigator.serviceWorker.controller){ location.reload(); }
      });
    });
    try{ reg.update(); }catch(e){}
    setInterval(()=>{ try{ reg.update(); }catch(e){} }, 60000);
  }).catch(()=>{});
}
render();
if(runRecurring()) render();          // 到点的定期项目自动补记
if(!LS.me) setTimeout(openWho, 400);

/* ---------------- 云同步启动 --------------- */
async function refreshFromServer(){
  const server = await Sync.pull();
  if(!server) return;
  const map = new Map(server.map(r=>[r.id, r]));
  // 保留本地还没推上去的（离线记的）
  records.filter(r=>!r.synced).forEach(r=>{ if(!map.has(r.id)) map.set(r.id, r); });
  records = Array.from(map.values()).sort((a,b)=>b.ts-a.ts);
  LS.save(records);
  runRecurring();                     // 拉到最新后再补记，靠确定性id去重不会重复
  render();
}
async function refreshDefsFromServer(){
  const serverDefs = await Sync.pullDefs();
  if(!serverDefs) return;
  const map = new Map(serverDefs.map(d=>[d.id, d]));
  recurDefs.forEach(d=>{ if(!map.has(d.id)) map.set(d.id, d); });  // 本地新加的也保留
  recurDefs = Array.from(map.values());
  REC.save(recurDefs);
  // 把本地有、云端还没有的推上去
  serverDefs && recurDefs.forEach(d=>{ if(!serverDefs.find(s=>s.id===d.id)) Sync.pushDef(d); });
  if(runRecurring()) LS.save(records);
  render();
  if($('#sheet4').classList.contains('on')) renderRecurList();
}
async function syncBoot(){
  if(!(window.Sync && Sync.init())) return;   // 未配置则单机运行
  // 先把离线期间记的补推上去
  for(const r of records.filter(r=>!r.synced)){ if(await Sync.push(r)) r.synced=true; }
  LS.save(records);
  await refreshFromServer();                   // 拉全家最新账
  await refreshDefsFromServer();               // 拉定期设定（重装/换机不丢）
  Sync.subscribe(refreshFromServer);           // 别人记账时实时刷新
  Sync.subscribeDefs(refreshDefsFromServer);   // 定期设定变化时实时刷新
}
syncBoot();
