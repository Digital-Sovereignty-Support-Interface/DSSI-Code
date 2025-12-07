/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドを検知し、技術的事実（チップス）を提示する。
 * 機能: HTTP/HTTPSのプロトコル判定、バックグラウンド経由の証明書模擬判定、ON/OFF制御。
 * 哲学: "Facts over Fear." (恐怖ではなく事実を)
 */

console.log("🛡️ DSSI Guard: Loaded.");

const TARGET_SELECTORS = 'input[type="password"]';
let guardInterval = null;

// ---------------------------------------------
// Helper: チップスの描画とイベント設定
// ---------------------------------------------
function renderChip(field, data) {
    // 1. 視覚的マーキング (枠線の適用)
    field.style.border = `2px solid ${data.borderColor}`;
    field.classList.add("dssi-observed-field");

    // 2. チップスの生成
    const chip = document.createElement("div");
    chip.className = "dssi-chip";
    
    // 危険度が高い場合、チップスの左線を強調
    if (data.borderColor === "#e74c3c" || data.borderColor === "#c0392b") {
        chip.style.borderLeft = `4px solid ${data.borderColor}`;
    } else {
        chip.style.borderLeft = `4px solid ${data.borderColor}`;
    }

    chip.innerHTML = `
        <span class="dssi-chip-title" style="color:${data.borderColor === '#e67e22' ? '#f1c40f' : '#e74c3c'}">${data.title}</span>
        ${data.fact}<br>
        ${data.purpose}<br>
        ${data.risk}<br>
        <strong>推奨:</strong> ${data.rec}
    `;
    document.body.appendChild(chip);

    // 3. 表示・非表示の制御ロジック
    const showChip = () => {
        const rect = field.getBoundingClientRect();
        const scrollY = window.scrollY || window.pageYOffset;
        const scrollX = window.scrollX || window.pageXOffset;

        // フィールドの真上に表示
        chip.style.top = `${rect.top + scrollY - chip.offsetHeight - 10}px`;
        chip.style.left = `${rect.left + scrollX}px`;
        chip.classList.add("dssi-visible");
    };

    const hideChip = () => {
        chip.classList.remove("dssi-visible");
    };

    // イベントリスナーの登録
    field.addEventListener("focus", showChip);
    field.addEventListener("mouseenter", showChip);
    field.addEventListener("blur", hideChip);
    field.addEventListener("mouseleave", hideChip);

    // 削除時のために参照を保持（簡易実装）
    field.dssiChipElement = chip;
}

// ---------------------------------------------
// Core Logic: フィールドごとの事実抽出プロセス
// ---------------------------------------------
async function processField(field) {
    // 既に処理済みならスキップ（二重表示防止）
    if (field.dataset.dssiBound) return;
    field.dataset.dssiBound = "true";

    const protocol = window.location.protocol;

    // デフォルトのデータ（標準HTTPS）
    let chipData = {
        title: "ℹ️ 技術情報: キー入力イベント",
        borderColor: "#e67e22", // オレンジ (注意)
        fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
        purpose: "【目的】 この技術は通常、利便性（入力補助など）のために使われます。",
        risk: "【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。",
        rec: "キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。"
    };

    // 1. HTTP判定 (非暗号化)
    if (protocol === 'http:') {
        chipData.title = "⚠️ 技術情報: 非暗号化通信 (HTTP)";
        chipData.borderColor = "#e74c3c"; // 赤 (危険)
        chipData.fact = "【事実】 このページの通信経路は暗号化されていません。";
        chipData.purpose = "【目的】 古いシステムの互換性維持、または設定ミスによりこの状態になっています。";
        chipData.risk = "【リスク】 同じネットワーク利用者や経路上の第三者が、内容を傍受・改ざん可能です。";
        chipData.rec = "機密情報の入力は避け、VPNの使用や別経路での連絡を検討してください。";
        
        // HTTPなら即描画
        renderChip(field, chipData);
    
    } else if (protocol === 'https:') {
        // 2. HTTPS詳細判定 (バックグラウンドへ問い合わせ)
        // ※ Chrome API制限のため、background.js 経由で模擬判定を行う
        try {
            chrome.runtime.sendMessage({
                type: "CHECK_CERTIFICATE",
                url: window.location.href
            }, (response) => {
                // エラーハンドリング（拡張機能が無効化された場合など）
                if (chrome.runtime.lastError) return;

                // 期限切れ等の異常があればデータを上書き
                if (response && response.status === "expired") {
                    chipData.title = "🚫 技術情報: 証明書期限切れ";
                    chipData.borderColor = "#c0392b"; // 濃い赤 (致命的)
                    chipData.fact = `【事実】 このサイトのセキュリティ証明書は期限が切れています。<br>(期限: ${response.expiry})`;
                    chipData.purpose = "【状況】 管理不備、あるいは攻撃者による偽サイトの可能性があります。";
                    chipData.risk = "【リスク】 暗号化が機能していないか、通信先が正当な相手ではありません。";
                    chipData.rec = "直ちに利用を中止してください。";
                }
                
                // 判定完了後に描画
                renderChip(field, chipData);
            });
        } catch (e) {
            // 通信エラー時はデフォルト（標準HTTPS）として描画
            renderChip(field, chipData);
        }
    }
}

function attachChips() {
    const passwordFields = document.querySelectorAll(TARGET_SELECTORS);
    passwordFields.forEach(processField);
}

// ---------------------------------------------
// Control Logic: 起動と停止 (Kill Switch対応)
// ---------------------------------------------

function startGuard() {
    if (guardInterval) return; // 既に動いていれば何もしない
    console.log("🛡️ DSSI Guard: Enabled.");
    
    attachChips();
    // 動的な変更を監視
    guardInterval = setInterval(attachChips, 2000);
}

function stopGuard() {
    // 動作していないなら何もしない
    if (!guardInterval && !document.querySelector('.dssi-observed-field')) return;
    
    console.log("🛡️ DSSI Guard: Disabled.");

    // 1. 監視の停止
    if (guardInterval) {
        clearInterval(guardInterval);
        guardInterval = null;
    }

    // 2. 物理的撤去（チップスと赤枠を消す）
    // 生成したチップス要素を削除
    document.querySelectorAll('.dssi-chip').forEach(el => el.remove());
    
    // 入力欄の状態をリセット
    document.querySelectorAll('.dssi-observed-field').forEach(field => {
        field.style.border = ""; // 枠線スタイルを削除
        field.classList.remove("dssi-observed-field");
        delete field.dataset.dssiBound;
    });
}

// ---------------------------------------------
// Entry Point: 設定読み込みとメッセージ受信
// ---------------------------------------------

// A. 起動時の設定確認
chrome.storage.local.get(['dssiEnabled'], (result) => {
    // デフォルトは true (undefinedのときもtrue扱い)
    if (result.dssiEnabled !== false) {
        startGuard();
    } else {
        console.log("🛡️ DSSI Guard: Starts in DISABLED mode.");
    }
});

// B. ポップアップからの指令受信
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TOGGLE_GUARD") {
        if (request.enabled) {
            startGuard();
        } else {
            stopGuard();
        }
    }
});