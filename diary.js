/**********************************************
 * 位置情報日記 Web クライアント（REST API 送信対応）
 * - 「📍現在地を記録する」: localStorage に保存
 * - 「📖日記を作成する」: 最新 1 件を API Gateway(REST) へ送信
 * - 送信 JSON: { deviceId, timestamp(ms), latitude, longitude, accuracy }
 * - API_URL / API_KEY は <meta> から取得（無ければ空）
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

// ---- DOM 参照 ----
const recordBtn     = document.getElementById('record-btn');
const createDiaryBtn= document.getElementById('create-diary-btn');
const locationsList = document.getElementById('locations-list');
const diaryResult   = document.getElementById('diary-result');

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
    const res = await postToAWS(latest);
    const msg = (res && res.address)
      ? `送信成功（住所: ${escapeHtml(res.address)}）`
      : '送信成功';
    setStatus(`${msg} / ${new Date().toLocaleString()}\nlat=${Number(latest.latitude).toFixed(6)}, lon=${Number(latest.longitude).toFixed(6)}`);
  } catch (e) {
    console.error(e);
    setStatus('送信に失敗しました。詳細はコンソールをご確認ください。');
    alert('送信に失敗しました。API設定・CORS・APIキーを確認してください。');
  }
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
        // Lambda 側はミリ秒の epoch と緯度経度の数値を期待
        timestamp: Date.now(),
        latitude:  Number(pos.coords.latitude),
        longitude: Number(pos.coords.longitude),
        accuracy:  pos.coords.accuracy != null ? Number(pos.coords.accuracy) : null
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
    longitude: Number(point.longitude),
    accuracy:  point.accuracy != null ? Number(point.accuracy) : null
  };

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = getApiKey();
  if (apiKey) headers['x-api-key'] = apiKey;

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  // 本番では Lambda が {"ok":true, "address":"..."} などを返す想定
  let json = null;
  try { json = await resp.json(); } catch { json = null; }

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json;
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
    const ts = typeof loc.timestamp === 'string' && !/^\d+$/.test(loc.timestamp)
      ? new Date(loc.timestamp)
      : new Date(Number(loc.timestamp || Date.now()));
    const li = document.createElement('li');
    li.textContent = `${ts.toLocaleString('ja-JP')} - 緯度: ${Number(loc.latitude).toFixed(5)}, 経度: ${Number(loc.longitude).toFixed(5)}`
      + (loc.accuracy != null ? `（精度: ${Math.round(Number(loc.accuracy))}m）` : '');
    locationsList.appendChild(li);
  }
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
