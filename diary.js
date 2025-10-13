const recordBtn = document.getElementById('record-btn');
const locationsList = document.getElementById('locations-list');

// 保存されているデータを取得して表示
document.addEventListener('DOMContentLoaded', () => {
    updateLocationsList();
});

// 現在地記録ボタンが押された時の処理
recordBtn.addEventListener('click', () => {
    // ブラウザが対応していなかったとき
    if (!navigator.geolocation) {
        alert('お使いのブラウザは位置情報機能に対応していません。');
        return;
    }

    // 位置情報を取得
    navigator.geolocation.getCurrentPosition(successCallback, errorCallback);
});

// 位置情報取得成功時のコールバック
function successCallback(position) {
    const newlocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: new Date().toISOString()
    };
    saveLocation(newlocation);
}

// 位置情報の取得に失敗した時
function errorCallback(error) {
    let errorMessage = "位置情報の取得に失敗しました。";
    switch(error.code) {
        case 1:
            errorMessage = "位置情報の利用が許可されていません。ブラウザの設定を確認してください。";
            break;
        case 2:
            errorMessage = "デバイスの位置が特定できませんでした。";
            break;
        case 3:
            errorMessage = "タイムアウトしました。";
            break;
    }
    alert(errorMessage);
    updateLocationsList();
}

// 位置情報をブラウザに保存
function saveLocation(location) {
    const locations = JSON.parse(localStorage.getItem('locations') || '[]');
    locations.push(location);
    localStorage.setItem('locations', JSON.stringify(locations));
    updateLocationsList();
}

// 保存されている位置情報をリストに表示
function updateLocationsList() {
    const locations = JSON.parse(localStorage.getItem('locations') || '[]');
    locationsList.innerHTML = '';

    if (locations.length === 0) {
        locationsList.innerHTML = '<li>まだ場所は記録されていません</li>';
    }else {
        locations.forEach(location => {
            const listItem = document.createElement('li');
            const date = new Date(location.timestamp).toLocaleTimeString('ja-JP');
            listItem.textContent = `${date} - 緯度: ${location.latitude.toFixed(5)}, 経度: ${location.longitude.toFixed(5)}`;
            locationsList.appendChild(listItem);
        });
    }
}

createDiaryBtn.addEventListener('click', () => {
    const locations = JSON.parse(localStorage.getItem('locations') || '[]');

    if (locations.length === 0) {
        alert('場所が記録されていません。');
        return;
    }

    // --- MQTT接続情報 ---
    // ⚠️これらは後でAWS IoT Coreで取得する情報に書き換えます
    const brokerHost = 'broker.hivemq.com'; // MQTTブローカーのホスト名（これはテスト用）
    const brokerPort = 8000;                // WebSocket用のポート番号
    const clientId = 'diary-app-' + new Date().getTime(); // ユニークなクライアントID
    const topic = 'diary/locations';        // 送信先のトピック名

    // MQTTクライアントの作成
    const client = new Paho.MQTT.Client(brokerHost, brokerPort, clientId);

    // 接続成功時の処理
    client.onConnectionLost = (responseObject) => {
        if (responseObject.errorCode !== 0) {
            console.log("onConnectionLost:" + responseObject.errorMessage);
            alert("ブローカーとの接続が切れました。");
        }
    };

    // メッセージ受信時の処理（今回は使わない）
    client.onMessageArrived = (message) => {
        console.log("onMessageArrived:" + message.payloadString);
    };

    // 接続オプション
    const connectOptions = {
        onSuccess: onConnect,
        onFailure: onFailure,
        useSSL: false // テスト用ブローカーなのでfalse。本番のAWSではtrueにします
    };
    
    // ブローカーへ接続
    diaryResult.innerHTML = '<p>サーバーに接続中です...</p>';
    client.connect(connectOptions);

    // 接続に成功したら呼ばれる関数
    function onConnect() {
        console.log("MQTTブローカーに接続しました。");
        diaryResult.innerHTML = '<p>位置情報を送信します...</p>';

        // 送信するメッセージを作成
        const payload = JSON.stringify(locations);
        const message = new Paho.MQTT.Message(payload);
        message.destinationName = topic;

        // メッセージを送信
        client.send(message);

        console.log("メッセージを送信しました:", payload);
        diaryResult.innerHTML = '<p>日記の作成をリクエストしました！</p>';

        // 送信が成功したらローカルのデータを削除
        localStorage.removeItem('locations');
        updateLocationsList();
    }

    // 接続に失敗したら呼ばれる関数
    function onFailure(response) {
        console.log("接続に失敗しました: " + response.errorMessage);
        diaryResult.innerHTML = `<p>サーバーへの接続に失敗しました。</p>`;
        alert("サーバーへの接続に失敗しました。");
    }
});