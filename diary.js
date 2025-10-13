/**********************************************
 * 位置情報日記 Web クライアント（accuracy無し）
 * - 📍 現在地を記録: localStorage('locations') に追加
 * - 📖 日記を作成: 全件をまとめて API Gateway（REST）へ POST
 *   → S3 保存は Lambda 側で実施
 * - 成功時に localStorage('locations') をクリア
 **********************************************/

// ========== 設定取得 ==========
function getApiUrl() {
  return (
    document.querySelector('meta[name="diary-api-url"]')?.content ||
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

// ========== DOM ==========
const recordBtn      = document.getElementById("record-btn");
const createDiaryBtn = document.getElementById("create-diary-btn");
const locationsList  = document.getElementById("locations-list");
const diaryResult    = document.getElementById("diary-result");

// ========== 初期化 ==========
document.addEventListener("DOMContentLoaded", () => {
  ensureDeviceId();
  updateLocationsList();
  if (!getApiUrl()) {
    setStatus(
      "⚠️ API URL が未設定です。<meta name=\"api-url\" content=\"https://<API_ID>.execute-api.<region>.amazonaws.com/prod/track\"> を設定してください。"
    );
  }
});

// ========== イベント ==========
recordBtn?.addEventListener("click", recordCurrentLocation);

// 日記を作成：全件まとめて送信し、成功時クリア
createDiaryBtn?.addEventListener("click", async () => {
  const list = readLocations();
  if (list.length === 0) {
    alert("場所が記録されていません。まず「現在地を記録する」を押してください。");
    return;
  }

  setStatus("日記をAWSへ送信中…");

  try {
    // accuracy を含めない正規化
    const normalized = list.map(p => ({
      lat: Number(p.lat ?? p.latitude),
      lon: Number(p.lon ?? p.longitude),
      timestamp:
        typeof p.timestamp === "string" && !/^\d+$/.test(p.timestamp)
          ? new Date(p.timestamp).toISOString()
          : new Date(Number(p.timestamp ?? Date.now())).toISOString()
    }));

    const payload = {
      deviceId: ensureDeviceId(),
      diaryCreatedAt: new Date().toISOString(),
      locations: normalized
    };

    await postDiaryToAWS(payload);

    setStatus("日記の送信に成功しました（S3保存はLambda側）。");

    // 成功したらローカルをクリア
    localStorage.removeItem("locations");
    updateLocationsList();
  } catch (e) {
    console.error(e);
    setStatus("送信に失敗しました。API設定・CORS・APIキーを確認してください。");
    alert("サーバーへの送信に失敗しました。");
  }
});

// ========== 機能本体：位置記録 ==========
function recordCurrentLocation() {
  if (!navigator.geolocation) {
    alert("このブラウザは位置情報に対応していません。");
    return;
  }
  setStatus("現在地を取得中…");
  navigator.geolocation.getCurrentPosition(
    pos => {
      const point = {
        timestamp: Date.now(), // ms
        latitude: Number(pos.coords.latitude),
        longitude: Number(pos.coords.longitude)
      };
      const list = readLocations();
      list.push(point);
      localStorage.setItem("locations", JSON.stringify(list));
      updateLocationsList();
      setStatus("現在地を保存しました。");
    },
    err => {
      const map = {
        1: "権限が拒否されています",
        2: "位置を特定できませんでした",
        3: "タイムアウトしました"
      };
      alert(`位置取得に失敗：${map[err.code] || err.message}`);
      setStatus("位置取得に失敗しました。");
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

// ========== 送信：日記用 ==========
async function postDiaryToAWS(payload) {
  const API_URL = getApiUrl();
  if (!API_URL) throw new Error("API_URL 未設定");

  const headers = { "Content-Type": "application/json" };
  const apiKey = getApiKey();
  if (apiKey) headers["x-api-key"] = apiKey;

  const resp = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  let json = null;
  try { json = await resp.json(); } catch { /* 空ボディ想定 */ }

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

// ========== ローカル保存ユーティリティ ==========
function readLocations() {
  try { return JSON.parse(localStorage.getItem("locations") || "[]"); }
  catch { return []; }
}

function updateLocationsList() {
  const list = readLocations();
  locationsList.innerHTML = "";
  if (list.length === 0) {
    locationsList.innerHTML = "<li>まだ場所は記録されていません</li>";
    return;
  }
  for (const loc of list) {
    const ts =
      typeof loc.timestamp === "string" && !/^\d+$/.test(loc.timestamp)
        ? new Date(loc.timestamp)
        : new Date(Number(loc.timestamp || Date.now()));
    const lat = Number(loc.lat ?? loc.latitude);
    const lon = Number(loc.lon ?? loc.longitude);
    const li = document.createElement("li");
    li.textContent = `${ts.toLocaleString("ja-JP")} - 緯度: ${lat.toFixed(
      5
    )}, 経度: ${lon.toFixed(5)}`;
    locationsList.appendChild(li);
  }
}

// ========== 共通ユーティリティ ==========
function ensureDeviceId() {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = "web-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("deviceId", id);
  }
  return id;
}
function setStatus(msg) {
  if (diaryResult) diaryResult.innerHTML = `<p>${escapeHtml(msg)}</p>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}
