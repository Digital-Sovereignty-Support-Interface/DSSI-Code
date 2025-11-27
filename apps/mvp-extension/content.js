/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドを検知し、技術的事実（チップス）を提示する。
 * ユーザーの指示により、即座に活動を停止（Cleanup）する機能を持つ。
 */

console.log("🛡️ DSSI Guard: Loaded.");

const TARGET_SELECTORS = 'input[type="password"]';
let guardInterval = null; // 監視ループのID

// ---------------------------------------------
// Core Logic: チップスの付与
// ---------------------------------------------
function attachChips() {
    const passwordFields = document.querySelectorAll(TARGET_SELECTORS);
    
    passwordFields.forEach((field) => {
        // 既に処理済みならスキップ
        if (field.dataset.dssiBound) return;
        field.dataset.dssiBound = "true";

        // 1. 視覚的マーキング
        field.classList.add("dssi-observed-field");

        // 2. チップスの生成
        const chip = document.createElement("div");
        chip.className = "dssi-chip";
        chip.innerHTML = `
            <span class="dssi-chip-title">ℹ️ 技術情報: キー入力イベント</span>
            【注意喚起】このフィールドへの入力操作は、スクリプトにより取得可能です。<br>
            【目的】 この技術は通常、ショートカットキーや入力補助などの「利便性」のために使われます。<br>
            【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。<br>
            <strong>推奨:</strong> キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。
        `;
        document.body.appendChild(chip);

        // 3. 表示制御ロジック（クロージャで保持）
        const showChip = () => {
            const rect = field.getBoundingClientRect();
            const scrollY = window.scrollY || window.pageYOffset;
            const scrollX = window.scrollX || window.pageXOffset;
            chip.style.top = `${rect.top + scrollY - chip.offsetHeight - 10}px`;
            chip.style.left = `${rect.left + scrollX}px`;
            chip.classList.add("dssi-visible");
        };
        const hideChip = () => {
            chip.classList.remove("dssi-visible");
        };

        // イベントリスナー登録
        field.addEventListener("focus", showChip);
        field.addEventListener("mouseenter", showChip);
        field.addEventListener("blur", hideChip);
        field.addEventListener("mouseleave", hideChip);

        // クリーンアップ用に要素に参照を持たせておく（簡易実装）
        field.dssiChipElement = chip;
    });
}

// ---------------------------------------------
// Control Logic: 起動と停止
// ---------------------------------------------

function startGuard() {
    if (guardInterval) return; // 既に動いていれば何もしない
    console.log("🛡️ DSSI Guard: Enabled.");
    
    attachChips();
    // 動的な変更を監視
    guardInterval = setInterval(attachChips, 2000);
}

function stopGuard() {
    if (!guardInterval && !document.querySelector('.dssi-observed-field')) return;
    console.log("🛡️ DSSI Guard: Disabled.");

    // 1. 監視の停止
    if (guardInterval) {
        clearInterval(guardInterval);
        guardInterval = null;
    }

    // 2. 物理的撤去（チップスと赤枠を消す）
    document.querySelectorAll('.dssi-chip').forEach(el => el.remove());
    document.querySelectorAll('.dssi-observed-field').forEach(field => {
        field.classList.remove("dssi-observed-field");
        delete field.dataset.dssiBound;
        // リスナーは残るが、チップスDOMが消えるので実質無害化
    });
}

// ---------------------------------------------
// Entry Point: 設定読み込みとメッセージ受信
// ---------------------------------------------

// A. 起動時の設定確認
chrome.storage.local.get(['dssiEnabled'], (result) => {
    // デフォルトは true
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