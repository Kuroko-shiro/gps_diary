/**********************************************
 * 位置情報日記 Web クライアント（REST API 送信対応）
 * - 「📍現在地を記録する」: localStorage に保存
 * - 「📖日記を作成する」: 最新1件 or 複数を API Gateway に送信（Lambda→S3）
 * - 送信 JSON: { deviceId, timestamp(ms), latitude, longitude }
 * - API_URL / API_KEY / VIEWER_URL は <meta> から取得
 **********************************************/

// ---- 設定の取得（index.html の <meta> から読む） ----
function getApiUrl() {
  return (
    document.querySelector('meta[name="api-url"]')?.content ||
    window.VITE_API_URL || window.NEXT_PUBLIC_API_URL || ""
  ).trim();
}
function getApiKey() {
  return (
    document.querySelector('meta[name="api-key"]')?.content ||
    window.VITE_API_KEY || window.NEXT_PUBLIC_API_KEY || ""
  ).trim();
}
function getViewerUrl() {
  return (document.querySelector('meta[name="viewer-url"]')?.content || "").trim();
}

// ---- DOM 参照 ----
const recordBtn       = document.getElementById('record-btn');
const createDiaryBtn  = document.getElementById('create-diary-btn');
const openViewerBtn   = document.getElementById('open-viewer-btn');   // 追加
const viewerLink      = document.getElementById('viewer-link');       // 追加（任意の <a>）
const locationsList   = document.getElementById('locations-list');
const diaryResult     = document.getElementById('diary-result');

// ---- 初期化 ----
document.addEventListener('DOMContentLoaded', () => {
  ensureDeviceId();
  updateLocationsList();

  if (!getApiUrl()) {
    setStatus('⚠️ API URL が未設定です。index.html に <meta name="api-url" content="https://.../prod/track"> を追加してください。');
  }
});

// ---- イベント ----
recordBtn?.addEventListener('click', () => recordCurrentLocation());

createDiaryBtn?.addEventListener('click', async () => {
  const list = readLocations();
  if (list.length === 0) {
    alert('場所が記録されていません。まず「現在地を記録する」を押してください。');
    return;
  }
  const latest = list[list.length - 1];
  setStatus('AWS に送信中…');

  try {
    const res = await postToAWS(latest);  // 単発送信（Lambda 側で正規化し points.jsonl へ集約）
    // 成功：ローカルの記録をクリア
    localStorage.removeItem('locations');
    updateLocationsList();

    const msg = (res && res.address)
      ? `送信成功（住所: ${escapeHtml(res.address)}）`
      : `送信成功（${list.length}件）`;

    setStatus(`${msg} / ${new Date().toLocaleString()}\nlat=${Number(latest.latitude).toFixed(6)}, lon=${Number(latest.longitude).toFixed(6)}`);

    // ビューアのディープリンクを作って表示
    const url = buildViewerDeepLink(latest);
    if (viewerLink) {
      viewerLink.href = url;
      viewerLink.style.display = 'inline';
    }
  } catch (e) {
    console.error(e);
    setStatus('送信に失敗しました。詳細はコンソールをご確認ください。');
    alert('送信に失敗しました。API設定・CORS・APIキーを確認してください。');
  }
});

// 「📊 可視化ページを開く」ボタン：最新ポイント日付 or 今日でビューアへ
openViewerBtn?.addEventListener('click', () => {
  const list = readLocations();
  const point = list.length ? list[list.length - 1] : null;
  const url = buildViewerDeepLink(point); // point が無ければ今日のUTCで作る
  if (!url) {
    alert('ビューアURLが未設定です（index.html の <meta name="viewer-url"> を確認）');
    return;
  }
  window.open(url, '_blank', 'noopener'); // 新しいタブで開く
});

// ---- 機能本体 ----
function recordCurrentLocation() {
  if (!navigator.geolocation) {
    alert('このブラウザは位置情報に対応していません。');
    return;
  }
  setStatus('現在地を取得中…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const point = {
        timestamp: Date.now(),                           // ms epoch
        latitude:  Number(pos.coords.latitude),
        longitude: Number(pos.coords.longitude)
        // accuracy は送らない（不要）
      };
      const list = readLocations();
      list.push(point);
      localStorage.setItem('locations', JSON.stringify(list));
      updateLocationsList();
      setStatus('現在地を保存しました。');
    },
    (err) => {
      const map = {1:'権限が拒否されています',2:'位置を特定できませんでした',3:'タイムアウトしました'};
      alert(`位置取得に失敗：${map[err.code] || err.message}`);
      setStatus('位置取得に失敗しました。');
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

async function postToAWS(point) {
  const API_URL = getApiUrl();
  if (!API_URL) throw new Error('API_URL 未設定');

  const payload = {
    deviceId: ensureDeviceId(),
    timestamp: point.timestamp ?? Date.now(),       // ms
    latitude:  Number(point.latitude),
    longitude: Number(point.longitude)
  };

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = getApiKey();
  if (apiKey) headers['x-api-key'] = apiKey;

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  let json = null;
  try { json = await resp.json(); } catch { json = null; }

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json || { ok:true };
}

// ---- ローカル保存（一覧表示） ----
function readLocations() {
  try { return JSON.parse(localStorage.getItem('locations') || '[]'); }
  catch { return []; }
}

function updateLocationsList() {
  const list = readLocations();
  locationsList.innerHTML = '';
  if (list.length === 0) {
    locationsList.innerHTML = '<li>まだ場所は記録されていません</li>';
    return;
  }
  for (const loc of list) {
    const ts = toDateFromMixed(loc.timestamp);
    const li = document.createElement('li');
    li.textContent = `${ts.toLocaleString('ja-JP')} - 緯度: ${Number(loc.latitude).toFixed(5)}, 経度: ${Number(loc.longitude).toFixed(5)}`;
    locationsList.appendChild(li);
  }
}

// ---- ビューア遷移（ディープリンク生成） ----
function buildViewerDeepLink(pointOrNull) {
  const base = getViewerUrl();
  if (!base) return "";

  const deviceId = ensureDeviceId();
  const dateUtc  = pointOrNull
    ? toUTCDateString(pointOrNull.timestamp)
    : new Date().toISOString().slice(0,10); // 今日(UTC)

  // 出力アプリ（表示APIフロント）が index.html?deviceId=...&date=YYYY-MM-DD に対応している想定
  const url = `${base.replace(/\/+$/,'')}/?deviceId=${encodeURIComponent(deviceId)}&date=${encodeURIComponent(dateUtc)}`;
  return url;
}

// ---- ユーティリティ ----
function ensureDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = 'web-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('deviceId', id);
  }
  return id;
}

function setStatus(msg) {
  if (!diaryResult) return;
  diaryResult.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function toDateFromMixed(v) {
  // ms/秒/ISO いずれも Date に
  if (typeof v === 'number') {
    const sec = v > 1e12 ? v/1000 : v;
    return new Date(sec * 1000);
  }
  if (typeof v === 'string' && /^\d{13}$/.test(v)) {
    return new Date(Number(v)); // ms文字列
  }
  return new Date(v); // ISOなど
}
function toUTCDateString(v) {
  const d = toDateFromMixed(v);
  // UTCで YYYY-MM-DD
  return new Date(d.toISOString()).toISOString().slice(0,10);
}
