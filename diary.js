/**********************************************
 * 位置情報日記 Web クライアント（REST API 送信対応／削除ボタン対応）
 * - 「現在地を記録する」: localStorage に保存
 * - 「日記を作成する」: 最新1件を API Gateway へ送信（Lambda→S3）
 * - 送信 JSON: { deviceId, timestamp(ms), latitude, longitude }  ※ accuracy は送らない
 * - API_URL / API_KEY / VIEWER_URL は <meta> から取得（無ければ空）
 * - 既存UIを崩さず、一覧に「削除」ボタンを追加
 **********************************************/

/* ========= 設定の取得（index.html の <meta>） ========= */
function getMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return (el && el.content ? el.content : "").trim();
}
function getApiUrl()  { return getMeta("api-url")  || window.VITE_API_URL || window.NEXT_PUBLIC_API_URL || ""; }
function getApiKey()  { return getMeta("api-key")  || window.VITE_API_KEY || window.NEXT_PUBLIC_API_KEY || ""; }
function getViewerUrl(){ return getMeta("viewer-url") || ""; }

/* ========= DOM 参照（無い要素は undefined でもOKに） ========= */
const recordBtn       = document.getElementById("record-btn");
const createDiaryBtn  = document.getElementById("create-diary-btn");
const locationsList   = document.getElementById("locations-list");
const diaryResult     = document.getElementById("diary-result");
const openViewerBtn   = document.getElementById("open-viewer-btn"); // もしHTMLに無ければ無視
const viewerLink      = document.getElementById("viewer-link");     // 任意の <a>

/* ========= 初期化 ========= */
document.addEventListener("DOMContentLoaded", () => {
  ensureDeviceId();
  updateLocationsList();

  if (!getApiUrl()) {
    setStatus("⚠️ API URL が未設定です。index.html に <meta name=\"api-url\" content=\"https://.../prod/track\"> を追加してください。");
  }
});

/* ========= イベント ========= */
// 現在地を記録
recordBtn && recordBtn.addEventListener("click", () => recordCurrentLocation());

// 日記を作成（＝最新1件を送信）
createDiaryBtn && createDiaryBtn.addEventListener("click", async () => {
  const list = readLocations();
  if (list.length === 0) {
    alert("場所が記録されていません。まず「現在地を記録する」を押してください。");
    return;
  }
  const latest = list[list.length - 1]; // 最新を単発送信
  setStatus("AWS に送信中…");

  try {
    const res = await postToAWS(latest);

    // 成功：ローカルの記録をクリア
    localStorage.removeItem("locations");
    updateLocationsList();

    const msg = (res && res.address)
      ? `送信成功（住所: ${escapeHtml(res.address)}）`
      : `送信成功（${list.length}件中 最新1件を送信）`;

    setStatus(`${msg} / ${new Date().toLocaleString()}
lat=${Number(latest.latitude).toFixed(6)}, lon=${Number(latest.longitude).toFixed(6)}`);

    // ビューワのディープリンクを表示（要素があれば）
    const url = buildViewerDeepLink(latest);
    if (viewerLink && url) {
      viewerLink.href = url;
      viewerLink.style.display = "inline";
    }
  } catch (e) {
    console.error(e);
    setStatus("送信に失敗しました。詳細はコンソールをご確認ください。");
    alert("送信に失敗しました。API設定・CORS・APIキーを確認してください。");
  }
});

// 可視化ページを開く（ボタンが存在する場合のみ）
openViewerBtn && openViewerBtn.addEventListener("click", () => {
  const list = readLocations();
  const point = list.length ? list[list.length - 1] : null;
  const url = buildViewerDeepLink(point); // 記録が無ければ今日UTC
  if (!url) {
    alert("ビューアURLが未設定です（index.html の <meta name=\"viewer-url\"> を確認）");
    return;
  }
  window.open(url, "_blank", "noopener");
});

// 一覧内「削除」ボタン（イベントデリゲーション）
locationsList && locationsList.addEventListener("click", (ev) => {
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;
  if (!t.classList.contains("delete-btn")) return;
  const idx = Number(t.dataset.index);
  if (!Number.isInteger(idx)) return;

  const arr = readLocations();
  if (idx < 0 || idx >= arr.length) return;

  // 1件削除して保存
  arr.splice(idx, 1);
  localStorage.setItem("locations", JSON.stringify(arr));
  updateLocationsList();
});

/* ========= 機能本体 ========= */
function recordCurrentLocation() {
  if (!navigator.geolocation) {
    alert("このブラウザは位置情報に対応していません。");
    return;
  }
  setStatus("現在地を取得中…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const point = {
        timestamp: Date.now(),               // ms epoch
        latitude:  Number(pos.coords.latitude),
        longitude: Number(pos.coords.longitude)
        // accuracy は送らない
      };
      const list = readLocations();
      list.push(point);
      localStorage.setItem("locations", JSON.stringify(list));
      updateLocationsList();
      setStatus("現在地を保存しました。");
    },
    (err) => {
      const map = {1:"権限が拒否されています",2:"位置を特定できませんでした",3:"タイムアウトしました"};
      alert(`位置取得に失敗：${map[err.code] || err.message}`);
      setStatus("位置取得に失敗しました。");
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

async function postToAWS(point) {
  const API_URL = getApiUrl();
  if (!API_URL) throw new Error("API_URL 未設定");

  const payload = {
    deviceId: ensureDeviceId(),
    timestamp: point.timestamp ?? Date.now(),  // ms
    latitude:  Number(point.latitude),
    longitude: Number(point.longitude)
  };

  const headers = { "Content-Type": "application/json" };
  const k = getApiKey();
  if (k) headers["x-api-key"] = k;

  const resp = await fetch(API_URL, { method:"POST", headers, body: JSON.stringify(payload) });
  let json = null;
  try { json = await resp.json(); } catch { json = null; }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json || { ok:true };
}

/* ========= ローカル保存（一覧表示 ＋ 削除ボタン） ========= */
function readLocations() {
  try { return JSON.parse(localStorage.getItem("locations") || "[]"); }
  catch { return []; }
}

function updateLocationsList() {
  if (!locationsList) return;
  const list = readLocations();
  locationsList.innerHTML = "";

  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = "まだ場所は記録されていません";
    locationsList.appendChild(li);
    return;
  }

  list.forEach((loc, idx) => {
    const ts = toDateFromMixed(loc.timestamp);
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent =
      `${ts.toLocaleString("ja-JP")} - 緯度: ${Number(loc.latitude).toFixed(5)}, 経度: ${Number(loc.longitude).toFixed(5)}`;

    const del = document.createElement("button");
    del.textContent = "削除";
    del.className = "delete-btn";
    del.dataset.index = String(idx);
    del.style.marginLeft = "8px";

    li.appendChild(span);
    li.appendChild(del);
    locationsList.appendChild(li);
  });
}

/* ========= ビューア遷移（任意） ========= */
function buildViewerDeepLink(pointOrNull) {
  const base = getViewerUrl();
  if (!base) return "";
  const deviceId = ensureDeviceId();
  const dateUtc  = pointOrNull ? toUTCDateString(pointOrNull.timestamp)
                               : new Date().toISOString().slice(0,10);
  return `${base.replace(/\/+$/,"")}/?deviceId=${encodeURIComponent(deviceId)}&date=${encodeURIComponent(dateUtc)}`;
}

/* ========= ユーティリティ ========= */
function ensureDeviceId() {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = "web-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("deviceId", id);
  }
  return id;
}
function setStatus(msg) {
  if (!diaryResult) return;
  diaryResult.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>\"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]));
}
function toDateFromMixed(v) {
  if (typeof v === "number") {
    const sec = v > 1e12 ? v/1000 : v;
    return new Date(sec*1000);
  }
  if (typeof v === "string" && /^\d{13}$/.test(v)) return new Date(Number(v));
  return new Date(v);
}
function toUTCDateString(v) {
  const d = toDateFromMixed(v);
  return new Date(d.toISOString()).toISOString().slice(0,10); // YYYY-MM-DD (UTC)
}
