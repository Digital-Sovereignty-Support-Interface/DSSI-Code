/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドを検知し、技術的事実（チップス）を提示する。
 * 哲学: "Facts over Fear." (恐怖ではなく事実を)
 */

console.log("🛡️ DSSI Guard: Active. Honest Defense Protocol initiated.");

const TARGET_SELECTORS = 'input[type="password"]';

function attachChips() {
    const passwordFields = document.querySelectorAll(TARGET_SELECTORS);
    
    passwordFields.forEach((field) => {
        // 既に処理済みならスキップ（二重表示防止）
        if (field.dataset.dssiBound) return;
        field.dataset.dssiBound = "true";

        // 1. 視覚的マーキング
        field.classList.add("dssi-observed-field");

        // 2. チップスの生成
        const chip = document.createElement("div");
        chip.className = "dssi-chip";
        chip.innerHTML = `
            <span class="dssi-chip-title">ℹ️ 技術情報: キー入力イベント</span>
            このフィールドへの入力操作は、スクリプトにより取得可能です。<br>
            <strong>推奨:</strong> キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。
        `;
        document.body.appendChild(chip);

        // 3. チップスの位置合わせと表示ロジック
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

        // イベントリスナー（フォーカス時とホバー時に表示）
        field.addEventListener("focus", showChip);
        field.addEventListener("mouseenter", showChip);
        
        field.addEventListener("blur", hideChip);
        field.addEventListener("mouseleave", hideChip);
    });
}

// 初回実行
attachChips();

// 動的な変更を監視（SPA対応の簡易版）
setInterval(attachChips, 2000);