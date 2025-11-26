/**
 * DSSI Content Script (Observer)
 * 責務: ページ内の入力フィールドを検知し、技術的事実（チップス）を提示する準備を行う。
 * 哲学: "Hidden facts must be visible."
 */

console.log("🛡️ DSSI Guard: Active. Observing DOM structure...");

// 監視対象の定義（Input Guard Mapに基づく）
const TARGET_SELECTORS = 'input[type="password"]';

function scanInputs() {
    const passwordFields = document.querySelectorAll(TARGET_SELECTORS);
    
    if (passwordFields.length > 0) {
        console.log(`👁️ DSSI Detected: ${passwordFields.length} password field(s).`);
        
        passwordFields.forEach((field, index) => {
            // まだ枠線を表示するだけ（干渉は最小限に）
            field.style.border = "2px solid #e74c3c"; // 赤枠で警告
            field.setAttribute("data-dssi-observed", "true");
            console.log(`   [${index}] Field detected. ID: ${field.id}, Name: ${field.name}`);
        });
    }
}

// 初回スキャン
scanInputs();

// 動的な変更を監視 (SPA対応など)
// ※今回は簡易的に実装。本格的にはMutationObserverを使用する予定。