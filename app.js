// 会員 → レシート → 明細可視化（依存なし）
// 列名が違う場合は COL をあなたのCSVに合わせる

const COL = {
  member: "匿名会員番号",
  receipt: "レシートID",     // 例: 取引ID / 伝票番号 / トランザクションID
  date: "買上日",
  storeName: "店舗名",
  item: "商品",
  amount: "買上金額",
  qty: "買上点数",           // 任意：無ければ 1 扱い
};

let RAW = [];
let HEADERS = [];
let MEMBER_LIST = [];
let RECEIPTS = [];
let CUR = 0;

const $ = (s) => document.querySelector(s);

function setStatus(msg){ $("#status").textContent = msg; }
function fmtInt(n){ return new Intl.NumberFormat("ja-JP").format(Math.round(n)); }
function fmtYen(n){ return new Intl.NumberFormat("ja-JP").format(Math.round(n)); }

function toDateKey(v){
  if(!v) return "";
  const s = String(v).trim().replaceAll("/", "-");
  return s.length >= 10 ? s.slice(0,10) : s;
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

// ★ 必須カラム注意書き（COLから自動生成）
function renderRequiredColumnsNote(){
  const el = document.getElementById("reqCols");
  if(!el) return;

  const required = [COL.member, COL.receipt, COL.date, COL.storeName, COL.item, COL.amount];
  const optional = [COL.qty];

  el.innerHTML =
    `必須: ${required.map(c=>`<span>${escapeHtml(c)}</span>`).join(" / ")}`
    + `<br>任意: ${optional.map(c=>`<span>${escapeHtml(c)}</span>`).join(" / ")}（無い場合は点数=1扱い）`;
}
renderRequiredColumnsNote();

// ---- CSV parser (minimal) ----
function parseCSV(text){
  const rows = [];
  let i=0, field="", row=[], inQ=false;

  while(i < text.length){
    const c = text[i];
    if(inQ){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i+=2; continue; }
        inQ=false; i++; continue;
      }else{
        field += c; i++; continue;
      }
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

function loadFromText(text){
  const grid = parseCSV(text);
  if(grid.length < 2) throw new Error("CSVが空っぽ");

  HEADERS = grid[0].map(h=>h.trim());

  const required = [COL.member, COL.receipt, COL.date, COL.storeName, COL.item, COL.amount];
  const missing = required.filter(c => !HEADERS.includes(c));
  if(missing.length){
    throw new Error(`必須列が足りない: ${missing.join(", ")}（CSVヘッダ or COLを合わせて）`);
  }

  RAW = grid.slice(1)
    .filter(r => r.length && r.some(x=>String(x).trim()!==""))
    .map(r=>{
      const o = {};
      for(let j=0;j<HEADERS.length;j++) o[HEADERS[j]] = r[j] ?? "";

      o.__member  = String(o[COL.member]).trim();
      o.__receipt = String(o[COL.receipt]).trim();
      o.__date    = toDateKey(o[COL.date]);
      o.__store   = String(o[COL.storeName]).trim();
      o.__item    = String(o[COL.item]).trim();
      o.__amt     = parseNum(o[COL.amount]);
      o.__qty     = HEADERS.includes(COL.qty) ? parseNum(o[COL.qty]) : 1;

      return o;
    });

  const set = new Set();
  for(const r of RAW) if(r.__member) set.add(r.__member);
  MEMBER_LIST = Array.from(set).sort();

  refreshMemberSelect();
  setStatus(`読込OK: ${fmtInt(RAW.length)}行 / 会員数: ${fmtInt(MEMBER_LIST.length)}`);
}

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

function buildReceiptsForMember(memberId, dateFilter){
  const lines = RAW.filter(r => r.__member === memberId && (!dateFilter || r.__date === dateFilter));

  const map = new Map();
  for(const r of lines){
    if(!r.__receipt) continue;
    if(!map.has(r.__receipt)){
      map.set(r.__receipt, { receiptId: r.__receipt, date: r.__date, store: r.__store, lines: [] });
    }
    map.get(r.__receipt).lines.push(r);
  }

  const receipts = Array.from(map.values()).map(rcpt=>{
    const sales = rcpt.lines.reduce((a,x)=>a+x.__amt,0);
    const qty = rcpt.lines.reduce((a,x)=>a+x.__qty,0);

    // 同一商品はレシート内でまとめる（見やすさ）
    const itemMap = new Map();
    for(const x of rcpt.lines){
      const key = x.__item || "（不明商品）";
      if(!itemMap.has(key)) itemMap.set(key, { item:key, amt:0, qty:0 });
      const o = itemMap.get(key);
      o.amt += x.__amt;
      o.qty += x.__qty;
    }
    const items = Array.from(itemMap.values()).sort((a,b)=>b.amt-a.amt);

    return {...rcpt, sales, qty, items};
  });

  receipts.sort((a,b)=>{
    if(a.date !== b.date) return a.date.localeCompare(b.date);
    return a.receiptId.localeCompare(b.receiptId);
  });

  return receipts;
}

function renderKPIs(){
  const n = RECEIPTS.length;
  const sales = RECEIPTS.reduce((a,r)=>a+r.sales,0);
  const qty = RECEIPTS.reduce((a,r)=>a+r.qty,0);
  const atv = n ? sales/n : 0;

  $("#k_rcpt").textContent = fmtInt(n);
  $("#k_sales").textContent = fmtYen(sales);
  $("#k_qty").textContent = fmtInt(qty);
  $("#k_atv").textContent = fmtYen(atv);
}

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

  $("#rcptIndex").textContent = `${CUR+1} / ${RECEIPTS.length}  receipt=${r.receiptId}`;
  $("#rcptMeta").textContent  = `${r.date}  |  ${r.store}  |  receipt=${r.receiptId}`;

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
}

function apply(){
  const memberId = $("#member").value;
  const dateFilter = $("#dateFilter").value || "";

  if(!memberId){
    setStatus("会員を選択してください");
    return;
  }

  RECEIPTS = buildReceiptsForMember(memberId, dateFilter);
  CUR = 0;

  renderKPIs();
  renderCurrentReceipt();
  setStatus(`会員=${memberId} / レシート=${fmtInt(RECEIPTS.length)}件`);
}

function clearAll(){
  $("#member").value = "";
  $("#dateFilter").value = "";
  RECEIPTS = [];
  CUR = 0;
  renderKPIs();
  renderCurrentReceipt();
  setStatus("クリア");
}

// ★ 左右キーでレシート切替（入力中は無効）
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
    CUR--;
    renderCurrentReceipt();
  }else if(e.key === "ArrowRight"){
    e.preventDefault();
    CUR++;
    renderCurrentReceipt();
  }
});

// ---- UI wiring ----
$("#apply").addEventListener("click", apply);
$("#clear").addEventListener("click", clearAll);
$("#prev").addEventListener("click", ()=>{ if(RECEIPTS.length){ CUR--; renderCurrentReceipt(); }});
$("#next").addEventListener("click", ()=>{ if(RECEIPTS.length){ CUR++; renderCurrentReceipt(); }});
$("#memberSearch").addEventListener("input", refreshMemberSelect);

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
  }catch(err){
    setStatus("読込失敗: " + (err?.message ?? String(err)));
  }
}
