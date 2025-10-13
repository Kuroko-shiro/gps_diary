/**********************************************
 * 位置情報日記 Web クライアント（REST API 送信対応・日記一括送信版）
 * - 「📍現在地を記録する」: localStorage に保存
 * - 「📖日記を作成する」: localStorageの全件をJSON化して API へ送信（S3保存はLambda側）
 * - 成功時は localStorage('locations') をクリア
 * - API_URL / DIARY_API_URL / API_KEY は <meta> から取得
 **********************************************/

// ---- 設定の取得（index.html の <meta> から読む） ----
function getApiUrl() {
  return (
    document.querySelector('meta[name="api-url"]')?.content ||
    window.VITE_API_URL || window.NEXT_PUBLIC_API_URL || ""
  ).trim();
}
// 日記送信用に別エンドポイントを使いたい場合は <meta name="diary-api-url"> を使う
function getDiaryApiUrl() {
  return (
    document.querySelector('meta[name="diary-api-url"]')?.content ||
    getApiUrl()
  ).trim();
}
function getApiKey() {
  return (
    document.querySelector('meta[name="api-key"]')?.content ||
    window.VITE_API_KEY || window.NEXT_PUBLIC_API_KEY || ""
  ).trim();
}

// ---- DOM 参照 ----
const recordBtn      = document.getElementById('record-btn');
const createDiaryBtn = document.getElementById('create-diary-btn');
const locationsList  = document.getElementById('locations-list');
const diaryResult    = document.getElementById('diary-result');

// ---- 初期化 ----
document.addEventListener('DOMContentLoaded', () => {
  ensureDeviceId();
  updateLocationsList();

  if (!getDiaryApiUrl()) {
    setStatus('⚠️ API URL が未設定です。index.html に <meta name="api-url" content="https://.../prod/track"> か、<meta name="diary-api-url"> を設定してください。');
  }
});

// ---- イベント ----
recordBtn?.addEventListener('click', () => recordCurrentLocation());

// ★ ここを「最新1件送信」→「全件まとめて日記送信」に変更
createDiaryBtn?.addEventListener('click', async () => {
  const list = readLocations();
  if (list.length === 0) {
    alert('場所が記録されていません。まず「現在地を記録する」を押してください。');
    return;
  }

  setStatus('日記（全件）をAWSに送信中…');

  try {
    // 送信用に正規化（lat/lon/timestampISO/accuracy）
    const normalized = list.map(p => ({
      lat: Number(p.latitude ?? p.lat),
      lon: Number(p.longitude ?? p.lon),
      timestamp: typeof p.timestamp === 'string' && !/^\d+$/.test(p.timestamp)
        ? new Date(p.timestamp).toISOString()
        : new Date(Number(p.timestamp || Date.now())).toISOString(),
      ...(p.accuracy != null ? { accuracy: Number(p.accuracy) } : {})
    }));

    const payload = {
      deviceId: ensureDeviceId(),
      diaryCreatedAt: new Date().toISOString(),  // このリクエスト自体の作成時刻
      locations: normalized                      // 日記本体
    };

    const resJson = await postDiaryToAWS(payload);

    // 成功表示
    const addrMsg = (resJson && resJson.address) ? `（代表地点: ${escapeHtml(resJson.address)}）` : '';
    setStatus(`日記の送信に成功しました${addrMsg}。保存先: S3（Lambda側）`);

    // ★ 成功したらローカルをクリア
    localStorage.removeItem('locations');
    updateLocationsList();

  } catch (e) {
    console.error(e);
    setStatus('送信に失敗しました。API設定・CORS・APIキーを確認してください。');
    alert('サーバーへの送信に失敗しました。');
  }
});

// ---- 機能本体（位置記録） ----
function recordCurrentLocation() {
  if (!navigator.geolocation) {
    alert('このブラウザは位置情報に対応していません。');
    return;
  }
  setStatus('現在地を取得中…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const point = {
        // 既存データとの互換を維持（latitude/longitude/timestamp[ms]）
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

// ---- AWS へ送信（★ 日記用：全件まとめて） ----
async function postDiaryToAWS(payload) {
  const API_URL = getDiaryApiUrl();
  if (!API_URL) throw new Error('DIARY_API_URL 未設定');

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

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }
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
    const lat = Number(loc.latitude ?? loc.lat);
    const lon = Number(loc.longitude ?? loc.lon);
    const acc = (loc.accuracy != null) ? `（精度: ${Math.round(Number(loc.accuracy))}m）` : '';
    li.textContent = `${ts.toLocaleString('ja-JP')} - 緯度: ${lat.toFixed(5)}, 経度: ${lon.toFixed(5)}${acc}`;
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
