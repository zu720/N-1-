// レシート見える君（トモズ）
// CSVにレシートIDが無い前提：会員×店舗×買上日×買上時間 で擬似レシート生成

// ====== ここだけ：あなたのCSVヘッダに合わせる ======
const COL = {
  member: "会員番号/匿名会員番号",
  date: "買上日",
  time: "買上時間",
  storeName: "店舗名",
  item: "商品名",
  amount: "買上金額（会員）",
  qty: "買上点数（会員）",

  // ↓ あれば絞り込みに使う（無ければ空でOK）
  maker: "メーカー/取引先",
  catL: "大分類",
  catM: "中分類",
  catS: "小分類",
  jan: "JANコード",
};
// ============================================

let RAW = [];
let HEADERS = [];
let MEMBER_LIST = [];
let RECEIPTS = [];
let CUR = 0;

const $ = (s) => document.querySelector(s);

function setStatus(msg){ $("#status").textContent = msg; }
function fmtInt(n){ return new Intl.NumberFormat("ja-JP").format(Math.round(n)); }
function fmtYen(n){ return new Intl.NumberFormat("ja-JP").format(Math.round(n)); }
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}
function toDateKey(v){
  if(!v) return "";
  const s = String(v).trim().replaceAll("/", "-");
  return s.length >= 10 ? s.slice(0,10) : s;
}
function normalizeTime(v){
  if(!v) return "";
  const s0 = String(v).trim();
  if(s0.includes(":")){
    const parts = s0.split(":").map(x=>x.trim()).filter(Boolean);
    const hh = (parts[0] ?? "00").padStart(2,"0").slice(0,2);
    const mm = (parts[1] ?? "00").padStart(2,"0").slice(0,2);
    const ss = (parts[2] ?? "00").padStart(2,"0").slice(0,2);
    return `${hh}:${mm}:${ss}`;
  }
  const s = s0.replace(/\D/g,"");
  if(s.length === 6) return `${s.slice(0,2)}:${s.slice(2,4)}:${s.slice(4,6)}`;
  if(s.length === 4) return `${s.slice(0,2)}:${s.slice(2,4)}:00`;
  if(s.length === 2) return `${s.slice(0,2)}:00:00`;
  return "";
}
function parseNum(v){
  if(v === null || v === undefined) return 0;
  const s = String(v).replaceAll(",", "").trim();
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
}
function parseCSV(text){
  const rows = [];
  let i=0, field="", row=[], inQ=false;
  while(i < text.length){
    const c = text[i];
    if(inQ){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i+=2; continue; }
        inQ=false; i++; continue;
      }else{ field += c; i++; continue; }
    }else{
      if(c === '"'){ inQ=true; i++; continue; }
      if(c === ","){ row.push(field); field=""; i++; continue; }
      if(c === "\n"){
        row.push(field); field="";
        if(row.length === 1 && row[0] === ""){ i++; row=[]; continue; }
        rows.push(row); row=[]; i++; continue;
      }
      if(c === "\r"){ i++; continue; }
      field += c; i++; continue;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}
function hasCol(name){ return !!name && HEADERS.includes(name); }
function valOrEmpty(o, colName){
  if(!colName) return "";
  if(!hasCol(colName)) return "";
  return String(o[colName] ?? "").trim();
}

// ===== 必須カラム注意書き（COLから生成） =====
function renderRequiredColumnsNote(){
  const el = document.getElementById("reqCols");
  if(!el) return;
  const required = [COL.member, COL.date, COL.time, COL.storeName, COL.item, COL.amount].filter(Boolean);
  const optional = [COL.qty, COL.maker, COL.catL, COL.catM, COL.catS, COL.jan].filter(Boolean);
  el.innerHTML =
    `必須: ${required.map(c=>`<span>${escapeHtml(c)}</span>`).join(" / ")}`
    + `<br>任意: ${optional.map(c=>`<span>${escapeHtml(c)}</span>`).join(" / ")}`
    + `<br><span class="muted">※ レシートID列は不要：会員×店舗×日時から自動生成</span>`;
}
renderRequiredColumnsNote();

// 擬似レシートID：会員 + 店舗 + 日付 + 時刻（秒）
function makePseudoReceiptId(r){
  const base = `${r.__member}|${r.__store}|${r.__date} ${r.__time}`;
  let h = 0;
  for(let i=0;i<base.length;i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return `R${h.toString(16)}_${r.__date.replaceAll("-","")}_${r.__time.replaceAll(":","")}`;
}

function loadFromText(text){
  const grid = parseCSV(text);
  if(grid.length < 2) throw new Error("CSVが空っぽ");

  HEADERS = grid[0].map(h=>h.trim());

  const required = [COL.member, COL.date, COL.time, COL.storeName, COL.item, COL.amount];
  const missing = required.filter(c => !HEADERS.includes(c));
  if(missing.length){
    throw new Error(`必須列が足りない: ${missing.join(", ")}（CSVヘッダ or COLを合わせて）`);
  }

  RAW = grid.slice(1)
    .filter(r => r.length && r.some(x=>String(x).trim()!==""))
    .map(r=>{
      const o = {};
      for(let j=0;j<HEADERS.length;j++) o[HEADERS[j]] = r[j] ?? "";

      o.__member = String(o[COL.member]).trim();
      o.__date   = toDateKey(o[COL.date]);
      o.__time   = normalizeTime(o[COL.time]);
      o.__store  = String(o[COL.storeName]).trim();
      o.__item   = String(o[COL.item]).trim();
      o.__amt    = parseNum(o[COL.amount]);
      o.__qty    = hasCol(COL.qty) ? parseNum(o[COL.qty]) : 1;

      if(!o.__time){
        throw new Error(`買上時間が解釈できない行があります。列「${COL.time}」の形式を確認してください（例: 13:05 や 130522 など）`);
      }

      o.__maker = valOrEmpty(o, COL.maker);
      o.__catL  = valOrEmpty(o, COL.catL);
      o.__catM  = valOrEmpty(o, COL.catM);
      o.__catS  = valOrEmpty(o, COL.catS);
      o.__jan   = valOrEmpty(o, COL.jan);

      o.__dtKey = `${o.__date} ${o.__time}`;
      o.__receipt = makePseudoReceiptId(o);
      return o;
    });

  const set = new Set();
  for(const r of RAW) if(r.__member) set.add(r.__member);
  MEMBER_LIST = Array.from(set).sort();

  refreshMemberSelect();
  setStatus(`読込OK: ${fmtInt(RAW.length)}行 / 会員数: ${fmtInt(MEMBER_LIST.length)}（レシートIDは自動生成）`);
}

// ===== UI: 会員セレクト =====
function refreshMemberSelect(){
  const q = ($("#memberSearch").value || "").trim();
  const list = q ? MEMBER_LIST.filter(m=>m.includes(q)) : MEMBER_LIST;
  const sel = $("#member");
  const current = sel.value;
  sel.innerHTML = `<option value="">（選択）</option>` + list.slice(0, 5000).map(m=>(
    `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`
  )).join("");
  if(current && list.includes(current)) sel.value = current;
}

function uniqSorted(arr){
  return Array.from(new Set(arr.filter(Boolean))).sort();
}
function fillSelect(id, values){
  const sel = $(id);
  const cur = sel.value;
  sel.innerHTML = [`<option value="">（全て）</option>`]
    .concat(values.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`))
    .join("");
  if(cur && values.includes(cur)) sel.value = cur;
}
function refreshFilterOptionsForMember(memberId){
  if(!memberId){
    fillSelect("#storeFilter", []);
    fillSelect("#makerFilter", []);
    fillSelect("#catLFilter", []);
    fillSelect("#catMFilter", []);
    fillSelect("#catSFilter", []);
    return;
  }
  const lines = RAW.filter(r => r.__member === memberId);
  fillSelect("#storeFilter", uniqSorted(lines.map(x=>x.__store)));
  fillSelect("#makerFilter", uniqSorted(lines.map(x=>x.__maker)));
  fillSelect("#catLFilter",  uniqSorted(lines.map(x=>x.__catL)));
  fillSelect("#catMFilter",  uniqSorted(lines.map(x=>x.__catM)));
  fillSelect("#catSFilter",  uniqSorted(lines.map(x=>x.__catS)));
}

// ===== レシート構築 =====
function buildReceiptsForMember(memberId, filters){
  const { dateFilter, store, maker, catL, catM, catS, janLike, itemLike } = filters;
  const janQ = (janLike || "").trim();
  const itemQ = (itemLike || "").trim();

  const lines = RAW.filter(r=>{
    if(r.__member !== memberId) return false;
    if(dateFilter && r.__date !== dateFilter) return false;
    if(store && r.__store !== store) return false;
    if(maker && r.__maker !== maker) return false;
    if(catL && r.__catL !== catL) return false;
    if(catM && r.__catM !== catM) return false;
    if(catS && r.__catS !== catS) return false;
    if(janQ && !r.__jan.includes(janQ)) return false;
    if(itemQ && !r.__item.includes(itemQ)) return false;
    return true;
  });

  const map = new Map();
  for(const r of lines){
    const key = r.__receipt;
    if(!map.has(key)){
      map.set(key, {
        receiptId: key,
        date: r.__date,
        time: r.__time,
        dtKey: r.__dtKey,
        store: r.__store,
        lines: []
      });
    }
    map.get(key).lines.push(r);
  }

  const receipts = Array.from(map.values()).map(rcpt=>{
    const sales = rcpt.lines.reduce((a,x)=>a+x.__amt,0);
    const qty = rcpt.lines.reduce((a,x)=>a+x.__qty,0);

    const itemMap = new Map();
    for(const x of rcpt.lines){
      const name = x.__item || "（不明商品）";
      if(!itemMap.has(name)) itemMap.set(name, { item:name, amt:0, qty:0 });
      const o = itemMap.get(name);
      o.amt += x.__amt;
      o.qty += x.__qty;
    }
    const items = Array.from(itemMap.values());
    return {...rcpt, sales, qty, items};
  });

  return receipts;
}

// ===== ソート =====
function sortReceipts(list, mode){
  const a = [...list];
  const cmpStr = (x,y)=> String(x).localeCompare(String(y));
  switch(mode){
    case "dt_asc":   a.sort((p,q)=> cmpStr(p.dtKey,q.dtKey) || cmpStr(p.store,q.store)); break;
    case "dt_desc":  a.sort((p,q)=> cmpStr(q.dtKey,p.dtKey) || cmpStr(p.store,q.store)); break;
    case "sales_asc":  a.sort((p,q)=> (p.sales-q.sales) || cmpStr(p.dtKey,q.dtKey)); break;
    case "sales_desc": a.sort((p,q)=> (q.sales-p.sales) || cmpStr(q.dtKey,p.dtKey)); break;
    case "qty_asc":  a.sort((p,q)=> (p.qty-q.qty) || cmpStr(p.dtKey,q.dtKey)); break;
    case "qty_desc": a.sort((p,q)=> (q.qty-p.qty) || cmpStr(q.dtKey,p.dtKey)); break;
    default: a.sort((p,q)=> cmpStr(q.dtKey,p.dtKey));
  }
  return a;
}
function sortItems(items, mode){
  const a = [...items];
  switch(mode){
    case "amt_asc": a.sort((p,q)=> p.amt-q.amt); break;
    case "amt_desc": a.sort((p,q)=> q.amt-p.amt); break;
    case "qty_asc": a.sort((p,q)=> p.qty-q.qty); break;
    case "qty_desc": a.sort((p,q)=> q.qty-p.qty); break;
    case "name_asc": a.sort((p,q)=> String(p.item).localeCompare(String(q.item))); break;
    default: a.sort((p,q)=> q.amt-p.amt);
  }
  return a;
}

// ===== 会員サマリー（条件内） =====
function renderMemberSummary(){
  const n = RECEIPTS.length;
  const sales = RECEIPTS.reduce((a,r)=>a+r.sales,0);
  const qty = RECEIPTS.reduce((a,r)=>a+r.qty,0);
  const atv = n ? sales/n : 0;

  const days = new Set(RECEIPTS.map(r=>r.date)).size;
  const stores = new Set(RECEIPTS.map(r=>r.store)).size;

  $("#k_rcpt").textContent = n ? fmtInt(n) : "-";
  $("#k_sales").textContent = n ? fmtYen(sales) : "-";
  $("#k_qty").textContent = n ? fmtInt(qty) : "-";
  $("#k_days").textContent = n ? fmtInt(days) : "-";
  $("#k_stores").textContent = n ? fmtInt(stores) : "-";
  $("#k_atv").textContent = n ? fmtYen(atv) : "-";
}

// ===== レシート一覧 =====
function renderReceiptList(){
  const box = $("#rcptList");
  if(!RECEIPTS.length){
    $("#listInfo").textContent = "-";
    box.innerHTML = `<div class="muted small">レシートがありません</div>`;
    return;
  }

  $("#listInfo").textContent = `件数=${RECEIPTS.length}`;

  box.innerHTML = RECEIPTS.map((r, idx)=>{
    const active = idx === CUR ? "active" : "";
    return `
      <button class="rcptBtn ${active}" data-idx="${idx}">
        <div class="rcptTop">
          <span class="mono">${escapeHtml(r.date)} ${escapeHtml(r.time)}</span>
          <span class="mono">¥${fmtYen(r.sales)}</span>
        </div>
        <div class="rcptMid mono">${escapeHtml(r.store)}</div>
        <div class="rcptBot">
          <span class="pill mono">点数 ${fmtInt(r.qty)}</span>
          <span class="pill mono">行 ${fmtInt(r.items.length)}</span>
        </div>
      </button>
    `;
  }).join("");

  box.querySelectorAll("button[data-idx]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      CUR = Number(btn.dataset.idx);
      renderCurrentReceipt();
      renderReceiptList();
    });
  });
}

// ===== レシート詳細 =====
function renderCurrentReceipt(){
  if(!RECEIPTS.length){
    $("#rcptIndex").textContent = "-";
    $("#rcptMeta").textContent = "-";
    $("#r_sales").textContent = "-";
    $("#r_qty").textContent = "-";
    $("#r_lines").textContent = "-";
    $("#items").innerHTML = `<tr><td colspan="4" class="muted">レシートがありません</td></tr>`;
    return;
  }

  CUR = Math.max(0, Math.min(CUR, RECEIPTS.length - 1));
  const r = RECEIPTS[CUR];

  $("#rcptIndex").textContent = `${CUR+1} / ${RECEIPTS.length}`;
  $("#rcptMeta").textContent  = `${r.date} ${r.time}  |  ${r.store}`;

  $("#r_sales").textContent = fmtYen(r.sales);
  $("#r_qty").textContent   = fmtInt(r.qty);

  const mode = $("#itemSort").value;
  const items = sortItems(r.items, mode);
  $("#r_lines").textContent = fmtInt(items.length);

  const maxAmt = Math.max(...items.map(x=>x.amt), 1);
  $("#items").innerHTML = items.map(x=>{
    const ratio = r.sales ? (x.amt / r.sales) : 0;
    const w = Math.round((x.amt / maxAmt) * 100);
    return `
      <tr>
        <td>${escapeHtml(x.item)}</td>
        <td class="right mono">${fmtYen(x.amt)}</td>
        <td class="right mono">${fmtInt(x.qty)}</td>
        <td>
          <div class="bar"><div style="width:${w}%"></div></div>
          <div class="small muted mono">${(ratio*100).toFixed(1)}%</div>
        </td>
      </tr>
    `;
  }).join("");
}

// ===== 反映 / クリア =====
function apply(){
  const memberId = $("#member").value;
  if(!memberId){ setStatus("会員を選択してください"); return; }

  const filters = {
    dateFilter: $("#dateFilter").value || "",
    store: $("#storeFilter").value || "",
    maker: $("#makerFilter").value || "",
    catL: $("#catLFilter").value || "",
    catM: $("#catMFilter").value || "",
    catS: $("#catSFilter").value || "",
    janLike: $("#janFilter").value || "",
    itemLike: $("#itemFilter").value || "",
  };

  let receipts = buildReceiptsForMember(memberId, filters);
  receipts = sortReceipts(receipts, $("#rcptSort").value);

  // itemsの初期ソートは renderCurrentReceipt 内でやる
  RECEIPTS = receipts;
  CUR = 0;

  renderMemberSummary();
  renderReceiptList();
  renderCurrentReceipt();

  setStatus(`会員=${memberId} / レシート=${fmtInt(RECEIPTS.length)}件（条件内サマリー表示中）`);
}

function clearAll(){
  $("#member").value = "";
  $("#dateFilter").value = "";
  $("#storeFilter").value = "";
  $("#makerFilter").value = "";
  $("#catLFilter").value = "";
  $("#catMFilter").value = "";
  $("#catSFilter").value = "";
  $("#janFilter").value = "";
  $("#itemFilter").value = "";
  $("#memberSearch").value = "";

  RECEIPTS = [];
  CUR = 0;

  renderMemberSummary();
  renderReceiptList();
  renderCurrentReceipt();
  refreshMemberSelect();

  setStatus("クリア");
}

// ===== キーボード：左右でレシート切替（入力中は無効） =====
function isTypingTarget(el){
  if(!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if(tag === "input" || tag === "textarea" || tag === "select") return true;
  if(el.isContentEditable) return true;
  return false;
}
document.addEventListener("keydown", (e)=>{
  if(!RECEIPTS.length) return;
  if(isTypingTarget(document.activeElement)) return;

  if(e.key === "ArrowLeft"){
    e.preventDefault();
    CUR = Math.max(0, CUR-1);
    renderCurrentReceipt(); renderReceiptList();
  }else if(e.key === "ArrowRight"){
    e.preventDefault();
    CUR = Math.min(RECEIPTS.length-1, CUR+1);
    renderCurrentReceipt(); renderReceiptList();
  }
});

// ===== UI wiring =====
$("#apply").addEventListener("click", apply);
$("#clear").addEventListener("click", clearAll);
$("#prev").addEventListener("click", ()=>{ if(RECEIPTS.length){ CUR=Math.max(0,CUR-1); renderCurrentReceipt(); renderReceiptList(); }});
$("#next").addEventListener("click", ()=>{ if(RECEIPTS.length){ CUR=Math.min(RECEIPTS.length-1,CUR+1); renderCurrentReceipt(); renderReceiptList(); }});
$("#memberSearch").addEventListener("input", refreshMemberSelect);
$("#member").addEventListener("change", ()=>{ refreshFilterOptionsForMember($("#member").value); });
$("#rcptSort").addEventListener("change", ()=>{ if(RECEIPTS.length) apply(); });
$("#itemSort").addEventListener("change", ()=>{ if(RECEIPTS.length) renderCurrentReceipt(); });

// Drag&Drop / File
const drop = $("#drop");
drop.addEventListener("dragover", (e)=>{ e.preventDefault(); drop.style.borderColor="rgba(37,99,235,.65)"; });
drop.addEventListener("dragleave", ()=>{ drop.style.borderColor="rgba(37,99,235,.35)"; });
drop.addEventListener("drop", async (e)=>{
  e.preventDefault(); drop.style.borderColor="rgba(37,99,235,.35)";
  const file = e.dataTransfer.files?.[0];
  if(file) await loadFile(file);
});
$("#file").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(file) await loadFile(file);
});

async function loadFile(file){
  try{
    const text = await file.text();
    loadFromText(text);

    // 初期状態をリセット
    RECEIPTS = []; CUR = 0;
    renderMemberSummary();
    renderReceiptList();
    renderCurrentReceipt();

  }catch(err){
    setStatus("読込失敗: " + (err?.message ?? String(err)));
  }
}

// 初期の空表示
renderMemberSummary();
renderReceiptList();
renderCurrentReceipt();

