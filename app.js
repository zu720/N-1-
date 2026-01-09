// ===== 列名（あなたのCSVに合わせて固定）=====
const COL = {
  member: "会員番号/匿名会員番号",
  date: "買上日",
  time: "買上時間",
  storeName: "店舗名",
  item: "商品名",
  amount: "買上金額（会員）",
  qty: "買上点数（会員）",
};

// ===== 状態 =====
let RAW = [];
let HEADERS = [];
let MEMBER_LIST = [];
let STORE_LIST = [];

let RECEIPTS_ALL = [];     // フィルタ後レシート一覧（本体）
let RECEIPTS_VIEW = [];    // タイムライン検索適用後（表示用）
let CUR = 0;

const $ = (s) => document.querySelector(s);

function setStatus(msg){ $("#status").textContent = msg; }
function setNote(msg){ $("#note").textContent = msg || ""; }

function fmtInt(n){ return new Intl.NumberFormat("ja-JP").format(Math.round(n)); }
function fmtYen(n){ return new Intl.NumberFormat("ja-JP").format(Math.round(n)); }

function toDateKey(v){
  if(!v) return "";
  const s = String(v).trim().replaceAll("/", "-");
  return s.length >= 10 ? s.slice(0,10) : s;
}
function normTime(v){
  // "19:00:00" / "19:00" / "190000" など雑多でもなるべく整形
  const t = String(v ?? "").trim();
  if(!t) return "";
  if(/^\d{6}$/.test(t)) return `${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
  if(/^\d{4}$/.test(t)) return `${t.slice(0,2)}:${t.slice(2,4)}:00`;
  if(/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t;
}
function parseNum(v){
  if(v === null || v === undefined) return 0;
  const s = String(v).replaceAll(",", "").trim();
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

// ---- CSV parser (minimal; quotes ok) ----
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

function assertColumns(){
  const required = [COL.member, COL.date, COL.time, COL.storeName, COL.item, COL.amount];
  const missing = required.filter(c => !HEADERS.includes(c));
  if(missing.length){
    throw new Error(`必須列が足りない: ${missing.join(", ")}（列名が違うならCOLを修正）`);
  }
}

function loadFromText(text){
  const grid = parseCSV(text);
  if(grid.length < 2) throw new Error("CSVが空");

  HEADERS = grid[0].map(h=>h.trim());
  assertColumns();

  RAW = grid.slice(1)
    .filter(r => r.length && r.some(x=>String(x).trim()!==""))
    .map(r=>{
      const o = {};
      for(let j=0;j<HEADERS.length;j++) o[HEADERS[j]] = r[j] ?? "";

      o.__member = String(o[COL.member] ?? "").trim();
      o.__date = toDateKey(o[COL.date]);
      o.__time = normTime(o[COL.time]);
      o.__store = String(o[COL.storeName] ?? "").trim();
      o.__item  = String(o[COL.item] ?? "").trim();
      o.__amt = parseNum(o[COL.amount]);
      o.__qty = HEADERS.includes(COL.qty) ? parseNum(o[COL.qty]) : 1;

      // 取引ユニークキー：会員+店舗+日付+時間（要件どおり）
      o.__receiptKey = `${o.__member}||${o.__store}||${o.__date}||${o.__time}`;

      // ソート用（文字列でも良いが、見やすいので epoch風に）
      o.__dt = `${o.__date}T${o.__time || "00:00:00"}`;

      return o;
    });

  // member/store lists
  const mset = new Set(), sset = new Set();
  for(const r of RAW){
    if(r.__member) mset.add(r.__member);
    if(r.__store) sset.add(r.__store);
  }
  MEMBER_LIST = Array.from(mset).sort();
  STORE_LIST  = Array.from(sset).sort();

  refreshMemberSelect();
  refreshStoreSelect();

  clearAll();
  setStatus(`読込OK: ${fmtInt(RAW.length)}行 / 会員数: ${fmtInt(MEMBER_LIST.length)} / 店舗数: ${fmtInt(STORE_LIST.length)}`);
  setNote("");
}

function refreshMemberSelect(){
  const q = ($("#memberSearch").value || "").trim();
  const list = q ? MEMBER_LIST.filter(m=>m.includes(q)) : MEMBER_LIST;
  const sel = $("#member");
  const cur = sel.value;

  sel.innerHTML = `<option value="">（選択）</option>` +
    list.slice(0, 8000).map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

  if(cur && list.includes(cur)) sel.value = cur;
}

function refreshStoreSelect(){
  const q = ($("#storeSearch").value || "").trim();
  const list = q ? STORE_LIST.filter(s=>s.includes(q)) : STORE_LIST;
  const sel = $("#store");
  const cur = sel.value;

  sel.innerHTML = `<option value="">（全て）</option>` +
    list.slice(0, 8000).map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");

  if(cur && list.includes(cur)) sel.value = cur;
}

function buildReceipts(memberId, storeName, dateFilter){
  const lines = RAW.filter(r=>{
    if(memberId && r.__member !== memberId) return false;
    if(storeName && r.__store !== storeName) return false;
    if(dateFilter && r.__date !== dateFilter) return false;
    return true;
  });

  const map = new Map();
  for(const r of lines){
    const k = r.__receiptKey;
    if(!map.has(k)){
      map.set(k, {
        key: k,
        member: r.__member,
        date: r.__date,
        time: r.__time,
        store: r.__store,
        dt: r.__dt,
        raw: [],
      });
    }
    map.get(k).raw.push(r);
  }

  const receipts = Array.from(map.values()).map(rcpt=>{
    // 同一レシート内：同一商品名をまとめる
    const itemMap = new Map();
    let sales=0, qty=0;

    for(const x of rcpt.raw){
      sales += x.__amt;
      qty   += x.__qty;

      const name = x.__item || "（不明商品）";
      if(!itemMap.has(name)) itemMap.set(name, { item:name, amt:0, qty:0 });
      const o = itemMap.get(name);
      o.amt += x.__amt;
      o.qty += x.__qty;
    }

    const items = Array.from(itemMap.values()).sort((a,b)=>b.amt-a.amt);

    // タイムライン検索用：商品名を連結して持っておく（重いなら後で改善）
    const itemText = items.map(x=>x.item).join(" ");

    return {
      ...rcpt,
      sales,
      qty,
      items,
      itemText,
    };
  });

  receipts.sort((a,b)=>{
    if(a.dt !== b.dt) return a.dt.localeCompare(b.dt);
    if(a.store !== b.store) return a.store.localeCompare(b.store);
    return a.key.localeCompare(b.key);
  });

  return receipts;
}

function applyTimelineSearch(){
  const q = ($("#timelineSearch").value || "").trim();
  if(!q){
    RECEIPTS_VIEW = RECEIPTS_ALL;
  }else{
    RECEIPTS_VIEW = RECEIPTS_ALL.filter(r=>{
      return (r.store && r.store.includes(q)) || (r.itemText && r.itemText.includes(q));
    });
  }

  // CURは「viewのindex」に合わせる：今見てるレシートがviewから消えたら0
  if(RECEIPTS_VIEW.length === 0){
    CUR = 0;
    renderKPIs();
    renderTimeline();
    renderReceipt();
    $("#tlMeta").textContent = `0 / ${RECEIPTS_ALL.length}`;
    return;
  }

  const currentKey = RECEIPTS_VIEW[CUR]?.key;
  if(!currentKey){
    CUR = 0;
  }else{
    const newIdx = RECEIPTS_VIEW.findIndex(r=>r.key === currentKey);
    CUR = newIdx >= 0 ? newIdx : 0;
  }

  renderKPIs();
  renderTimeline();
  renderReceipt();
  $("#tlMeta").textContent = `${fmtInt(RECEIPTS_VIEW.length)} / ${fmtInt(RECEIPTS_ALL.length)}`;
}

function renderKPIs(){
  const n = RECEIPTS_VIEW.length;
  const sales = RECEIPTS_VIEW.reduce((a,r)=>a+r.sales,0);
  const qty   = RECEIPTS_VIEW.reduce((a,r)=>a+r.qty,0);
  const atv   = n ? sales/n : 0;

  $("#k_rcpt").textContent = n ? fmtInt(n) : "-";
  $("#k_sales").textContent = n ? fmtYen(sales) : "-";
  $("#k_qty").textContent = n ? fmtInt(qty) : "-";
  $("#k_atv").textContent = n ? fmtYen(atv) : "-";
}

function renderTimeline(){
  const ul = $("#timeline");
  if(!RECEIPTS_VIEW.length){
    ul.innerHTML = `<li class="it"><div class="muted">レシートがありません</div></li>`;
    $("#tlMeta").textContent = `-`;
    return;
  }

  const rows = RECEIPTS_VIEW.map((r, idx)=>{
    const active = idx === CUR ? "active" : "";
    const topL = `${r.date} ${r.time || ""}`.trim();
    const topR = `${fmtYen(r.sales)}`;
    const midL = r.store || "";
    const midR = `${fmtInt(r.qty)}点 / ${fmtInt(r.items.length)}品`;
    return `
      <li class="it ${active}" data-idx="${idx}">
        <div class="itTop">
          <div class="mono">${escapeHtml(topL)}</div>
          <div class="mono itAmt">${escapeHtml(topR)}</div>
        </div>
        <div class="itMid">
          <div class="muted">${escapeHtml(midL)}</div>
          <div class="muted mono">${escapeHtml(midR)}</div>
        </div>
      </li>
    `;
  }).join("");

  ul.innerHTML = rows;

  // click handlers (event delegation)
  ul.querySelectorAll(".it").forEach(li=>{
    li.addEventListener("click", ()=>{
      CUR = Number(li.dataset.idx);
      renderTimeline();
      renderReceipt();
    });
  });

  $("#tlMeta").textContent = `${fmtInt(RECEIPTS_VIEW.length)}件`;
}

function renderReceipt(){
  if(!RECEIPTS_VIEW.length){
    $("#rcptIndex").textContent = "-";
    $("#rcptMeta").textContent = "-";
    $("#r_sales").textContent = "-";
    $("#r_qty").textContent = "-";
    $("#r_lines").textContent = "-";
    $("#items").innerHTML = `<tr><td colspan="4" class="muted">レシートがありません</td></tr>`;
    return;
  }

  CUR = Math.max(0, Math.min(CUR, RECEIPTS_VIEW.length-1));
  const r = RECEIPTS_VIEW[CUR];

  $("#rcptIndex").textContent = `${CUR+1} / ${RECEIPTS_VIEW.length}`;
  $("#rcptMeta").textContent  = `${r.date} ${r.time || ""} | ${r.store} | member=${r.member}`;

  $("#r_sales").textContent = fmtYen(r.sales);
  $("#r_qty").textContent   = fmtInt(r.qty);
  $("#r_lines").textContent = fmtInt(r.items.length);

  const maxAmt = Math.max(...r.items.map(x=>x.amt), 1);

  $("#items").innerHTML = r.items.map(x=>{
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

  // highlight current in timeline (already rerendered sometimes)
}

function jumpToCurrent(){
  const ul = $("#timeline");
  const active = ul.querySelector(".it.active");
  if(active) active.scrollIntoView({block:"center"});
}

function apply(){
  const memberId = $("#member").value;
  const storeName = $("#store").value;
  const dateFilter = $("#dateFilter").value || "";

  if(!memberId){
    setStatus("会員を選択してから反映。");
    return;
  }

  RECEIPTS_ALL = buildReceipts(memberId, storeName, dateFilter);
  RECEIPTS_VIEW = RECEIPTS_ALL;
  CUR = 0;

  applyTimelineSearch(); // ここでrenderも走る

  setStatus(`member=${memberId} / store=${storeName||"全て"} / date=${dateFilter||"全て"} / receipts=${fmtInt(RECEIPTS_ALL.length)}`);
}

function clearAll(){
  $("#member").value = "";
  $("#store").value = "";
  $("#dateFilter").value = "";
  $("#timelineSearch").value = "";
  RECEIPTS_ALL = [];
  RECEIPTS_VIEW = [];
  CUR = 0;
  renderKPIs();
  renderTimeline();
  renderReceipt();
  setStatus("クリア");
}

// ---- UI wiring ----
$("#apply").addEventListener("click", apply);
$("#clear").addEventListener("click", clearAll);

$("#prev").addEventListener("click", ()=>{
  if(!RECEIPTS_VIEW.length) return;
  CUR = Math.max(0, CUR-1);
  renderTimeline();
  renderReceipt();
  jumpToCurrent();
});
$("#next").addEventListener("click", ()=>{
  if(!RECEIPTS_VIEW.length) return;
  CUR = Math.min(RECEIPTS_VIEW.length-1, CUR+1);
  renderTimeline();
  renderReceipt();
  jumpToCurrent();
});

$("#jumpNow").addEventListener("click", jumpToCurrent);

$("#memberSearch").addEventListener("input", refreshMemberSelect);
$("#storeSearch").addEventListener("input", refreshStoreSelect);
$("#timelineSearch").addEventListener("input", ()=>{
  // 反映ボタン不要で即フィルタ（気持ちよさ優先）
  applyTimelineSearch();
});

// Drag&Drop / File
const drop = $("#drop");
drop.addEventListener("dragover", (e)=>{ e.preventDefault(); drop.style.borderColor="#60a5fa"; });
drop.addEventListener("dragleave", ()=>{ drop.style.borderColor="#3a4967"; });
drop.addEventListener("drop", async (e)=>{
  e.preventDefault(); drop.style.borderColor="#3a4967";
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
  }catch(err){
    setStatus("読込失敗: " + (err?.message ?? String(err)));
    setNote("CSVの列名が想定と違うか、文字コードが怪しい。列名は app.js の COL を見ろ。");
  }
}
