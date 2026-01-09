// 会員 → （擬似レシートID生成）→ レシート → 明細可視化（依存なし）
//
// ★重要：CSVに「レシートID列」は不要。
// 代わりに、会員+店舗+買上日+買上時間 から擬似レシートIDを作る。

const COL = {
  member: "会員番号/匿名会員番号",
  date: "買上日",
  time: "買上時間",
  storeName: "店舗名",
  item: "商品名",
  amount: "買上金額（会員）",
  qty: "買上点数（会員）", // 任意：無ければ1扱い
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

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

function toDateKey(v){
  if(!v) return "";
  const s = String(v).trim().replaceAll("/", "-");
  // 2026-01-09 形式の想定。違うならここで正規化。
  return s.length >= 10 ? s.slice(0,10) : s;
}

function normalizeTime(v){
  // "13:05", "13:05:22", "1305", "130522" などを "HH:MM:SS" に寄せる
  if(!v) return "";
  const s0 = String(v).trim();

  if(s0.includes(":")){
    const parts = s0.split(":").map(x=>x.trim()).filter(Boolean);
    const hh = (parts[0] ?? "00").padStart(2,"0").slice(0,2);
    const mm = (parts[1] ?? "00").padStart(2,"0").slice(0,2);
    const ss = (parts[2] ?? "00").padStart(2,"0").slice(0,2);
    return `${hh}:${mm}:${ss}`;
  }

  const s = s0.replace(/\D/g,""); // 数字以外除去
  if(s.length === 6){
    return `${s.slice(0,2)}:${s.slice(2,4)}:${s.slice(4,6)}`;
  }
  if(s.length === 4){
    return `${s.slice(0,2)}:${s.slice(2,4)}:00`;
  }
  if(s.length === 2){
    return `${s.slice(0,2)}:00:00`;
  }
  return ""; // パースできない場合
}

function parseNum(v){
  if(v === null || v === undefined) return 0;
  const s = String(v).replaceAll(",", "").trim();
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
}

// ★ 必須カラム注意書き（COLから自動生成）
function renderRequiredColumnsNote(){
  const el = document.getElementById("reqCols");
  if(!el) return;

  const required = [COL.member, COL.date, COL.time, COL.storeName, COL.item, COL.amount];
  const optional = [COL.qty];

  el.innerHTML =
    `必須: ${required.map(c=>`<span>${escapeHtml(c)}</span>`).join(" / ")}`
    + `<br>任意: ${optional.map(c=>`<span>${escapeHtml(c)}</span>`).join(" / ")}（無い場合は点数=1扱い）`
    + `<br><span class="muted">※ レシートID列は不要：会員×店舗×日時から自動生成</span>`;
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

// ★ 擬似レシートID生成：会員 + 店舗 + 日付 + 時刻（秒まで）
// 事故が怖いなら storeCode も混ぜるとより堅い
function makePseudoReceiptId(r){
  const member = r.__member || "NA";
  const store = r.__store || "NA";
  const dt = `${r.__date} ${r.__time}`.trim();

  // 文字を少し潰して短くする
  const base = `${member}|${store}|${dt}`;
  // 安直ハッシュ（短くするだけ・暗号じゃない）
  let h = 0;
  for(let i=0;i<base.length;i++){
    h = (h * 31 + base.charCodeAt(i)) >>> 0;
  }
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
      o.__qty    = HEADERS.includes(COL.qty) ? parseNum(o[COL.qty]) : 1;

      // 時刻が壊れてるとレシートが作れないので、ここでエラーにする（安全側）
      if(!o.__time){
        // ここで緩めたいなら "00:00:00" を入れて続行できるが、混ざるので非推奨
        throw new Error(`買上時間が解釈できない行があります。列「${COL.time}」の形式を確認してください（例: 13:05 や 130522 など）`);
      }

      o.__receipt = makePseudoReceiptId(o);
      return o;
    });

  const set = new Set();
  for(const r of RAW) if(r.__member) set.add(r.__member);
  MEMBER_LIST = Array.from(set).sort();

  refreshMemberSelect();
  setStatus(`読込OK: ${fmtInt(RAW.length)}行 / 会員数: ${fmtInt(MEMBER_LIST.length)}（レシートIDは自動生成）`);
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
    const key = r.__receipt;
    if(!map.has(key)){
      map.set(key, {
        receiptId: key, // 内部用（表示には出さない）
        date: r.__date,
        time: r.__time,
        store: r.__store,
        lines: []
      });
    }
    map.get(key).lines.push(r);
  }

  const receipts = Array.from(map.values()).map(rcpt=>{
    const sales = rcpt.lines.reduce((a,x)=>a+x.__amt,0);
    const qty = rcpt.lines.reduce((a,x)=>a+x.__qty,0);

    // 同一商品はレシート内でまとめる（見やすさ）
    const itemMap = new Map();
    for(const x of rcpt.lines){
      const name = x.__item || "（不明商品）";
      if(!itemMap.has(name)) itemMap.set(name, { item:name, amt:0, qty:0 });
      const o = itemMap.get(name);
      o.amt += x.__amt;
      o.qty += x.__qty;
    }
    const items = Array.from(itemMap.values()).sort((a,b)=>b.amt-a.amt);

    return {...rcpt, sales, qty, items};
  });

  // 日付→時刻→店舗 で並べる（閲覧体験が自然）
  receipts.sort((a,b)=>{
    if(a.date !== b.date) return a.date.localeCompare(b.date);
    if(a.time !== b.time) return a.time.localeCompare(b.time);
    return a.store.localeCompare(b.store);
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

  // ★表示から receiptId は消す（要望通り）
  $("#rcptIndex").textContent = `${CUR+1} / ${RECEIPTS.length}`;
  $("#rcptMeta").textContent  = `${r.date} ${r.time}  |  ${r.store}`;

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
  setStatus(`会員=${memberId} / レシート=${fmtInt(RECEIPTS.length)}件（レシートIDは自動生成）`);
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


