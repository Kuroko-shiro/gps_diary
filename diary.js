/**********************************************
 * 位置情報日記 Web クライアント（REST API 送信対応／accuracy無し）
 * - 📍 現在地を記録: localStorage に保存
 * - 🗑️ 個別削除: リストの「削除」ボタンで1件ずつ消せる
 * - 📖 日記を作成: 保存済みの全ポイント配列を API に送信
 *   送信 JSON: { deviceId, locations:[{lat,lon,timestamp(ms)}...] }
 *   → 成功後に localStorage をリセット（0から再記録）
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
const recordBtn      = document.getElementById('record-btn');
const createDiaryBtn = document.getElementById('create-diary-btn');
const locationsList  = document.getElementById('locations-list');
const diaryResult    = document.getElementById('diary-result');

// ---- 初期化 ----
document.addEventListener('DOMContentLoaded', () => {
  ensureDeviceId();
  updateLocationsList();

  // 個別削除（イベント委譲）
  locationsList?.addEventListener('click', (e) => {
    const btn = e.target;
    if (btn && btn.classList?.contains('delete-btn')) {
      const idx = Number(btn.dataset.index);
      deleteLocation(idx);
    }
  });

  if (!getApiUrl()) {
    setStatus('⚠️ API URL が未設定です。index.html に <meta name="api-url" content="https://.../prod/track"> を追加してください。');
  }
});

// ---- イベント ----
recordBtn?.addEventListener('click', recordCurrentLocation);

createDiaryBtn?.addEventListener('click', async () => {
  const list = readLocations();
  if (list.length === 0) {
    alert('場所が記録されていません。まず「現在地を記録する」を押してください。');
    return;
  }

  // 記録“当時”の値をそのまま送る（送信時の再取得はしない）
  const payload = {
    deviceId: ensureDeviceId(),
    locations: list.map(p => ({
      lat: Number(p.latitude ?? p.lat),
      lon: Number(p.longitude ?? p.lon),
      timestamp: Number(p.timestamp) // ms（記録時）
    }))
  };

  console.log('POST payload =', payload);
  setStatus('AWS に送信中…');

  try {
    const res = await postToAWS(payload);
    const msg = (res && res.address)
      ? `送信成功（住所: ${escapeHtml(res.address)}）`
      : '送信成功';
    setStatus(`${msg} / ${new Date().toLocaleString()}`);

    // ★ 成功したらローカルをリセット
    localStorage.removeItem('locations');
    updateLocationsList();
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
        timestamp: Date.now(),                          // 記録時のミリ秒
        latitude:  Number(pos.coords.latitude),
        longitude: Number(pos.coords.longitude)
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

async function postToAWS(payload) {
  const API_URL = getApiUrl();
  if (!API_URL) throw new Error('API_URL 未設定');

  // ヘッダは先に作る（TDZ回避 & 衝突回避）
  const hdrs = { 'Content-Type': 'application/json' };
  const apiKey = getApiKey();
  if (apiKey) hdrs['x-api-key'] = apiKey;

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify(payload)
  });

  // 失敗時は本文も拾ってデバッグしやすく
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${text}`);
  }
  try { return await resp.json(); } catch { return {}; }
}

// ---- ローカル保存（一覧表示 & 個別削除） ----
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
  list.forEach((loc, index) => {
    const ts = typeof loc.timestamp === 'string' && !/^\d+$/.test(loc.timestamp)
      ? new Date(loc.timestamp)
      : new Date(Number(loc.timestamp || Date.now()));

    const li = document.createElement('li');

    const span = document.createElement('span');
    const lat = Number(loc.latitude ?? loc.lat);
    const lon = Number(loc.longitude ?? loc.lon);
    span.textContent = `${ts.toLocaleString('ja-JP')} - 緯度: ${lat.toFixed(5)}, 経度: ${lon.toFixed(5)}`;

    const del = document.createElement('button');
    del.textContent = '削除';
    del.className = 'delete-btn';
    del.dataset.index = String(index);
    del.style.marginLeft = '8px';

    li.appendChild(span);
    li.appendChild(del);
    locationsList.appendChild(li);
  });
}

function deleteLocation(index) {
  const list = readLocations();
  if (index >= 0 && index < list.length) {
    list.splice(index, 1);
    localStorage.setItem('locations', JSON.stringify(list));
    updateLocationsList();
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
