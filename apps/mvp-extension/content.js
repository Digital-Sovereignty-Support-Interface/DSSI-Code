/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドを検知し、技術的事実（チップス）を提示する。
 * 機能: マルチターゲット検知、HTTP/HTTPS判定、バックグラウンド連携、ON/OFF制御。
 * 哲学: "Facts over Fear." (恐怖ではなく事実を)
 */

console.log("🛡️ DSSI Guard: Loaded.");

// 監視対象の拡大 (Email, Credit Cardを追加)
const TARGET_SELECTORS = 'input[type="password"], input[type="email"], input[name*="card"], input[name*="cc-"], input[id*="card"]';
let guardInterval = null;

// ---------------------------------------------
// Logic: フィールドごとの定義 (Definitions)
// ---------------------------------------------
function getFieldConfig(field) {
    const type = field.type;
    const name = (field.name || field.id || "").toLowerCase();

    // A. パスワードフィールド
    if (type === "password") {
        return {
            title: "ℹ️ 技術情報: キー入力イベント",
            borderColor: "#e67e22", // オレンジ
            fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
            purpose: "【目的】 この技術は通常、利便性（入力補助など）のために使われます。",
            risk: "【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。",
            rec: "キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。"
        };
    }
    
    // B. クレジットカードフィールド (簡易判定)
    if (name.includes("card") || name.includes("cc-") || name.includes("cvc")) {
        return {
            title: "💳 技術情報: 決済情報の入力",
            borderColor: "#e67e22", // オレンジ
            fact: "【確認】 財務資産に直結する情報の入力欄です。",
            purpose: "【目的】 サービスや商品の購入決済に使用されます。",
            risk: "【リスク】 通信経路や保存方法に不備がある場合、資産の不正利用に直結します。",
            rec: "ブラウザのアドレスバーに「鍵マーク(HTTPS)」があるか、必ず再確認してください。"
        };
    }

    // C. メールアドレスフィールド
    if (type === "email") {
        return {
            title: "📧 技術情報: 連絡先情報の入力",
            borderColor: "#3498db", // 青 (注意レベル低)
            fact: "【確認】 個人を特定、追跡可能なID（メールアドレス）の入力欄です。",
            purpose: "【目的】 連絡、認証、およびユーザーのトラッキング（追跡）に使用されます。",
            risk: "【リスク】 フィッシングサイトの場合、入力した時点でリスト化される可能性があります。",
            rec: "このサイトのドメイン（URL）が、意図した相手のものであるか確認してください。"
        };
    }

    // デフォルト（該当なし）
    return null;
}

// ---------------------------------------------
// Helper: チップスの描画
// ---------------------------------------------
function renderChip(field, data) {
    // 枠線の適用
    field.style.border = `2px solid ${data.borderColor}`;
    field.classList.add("dssi-observed-field");

    // チップスの生成
    const chip = document.createElement("div");
    chip.className = "dssi-chip";
    
    // 危険度に応じた左線の色
    const leftBorderColor = (data.borderColor === "#e74c3c" || data.borderColor === "#c0392b") 
                            ? data.borderColor : data.borderColor;
    chip.style.borderLeft = `4px solid ${leftBorderColor}`;

    chip.innerHTML = `
        <span class="dssi-chip-title" style="color:${leftBorderColor === '#e67e22' ? '#f1c40f' : (leftBorderColor === '#3498db' ? '#3498db' : '#e74c3c')}">${data.title}</span>
        ${data.fact}<br>
        ${data.purpose}<br>
        ${data.risk}<br>
        <strong>推奨:</strong> ${data.rec}
    `;
    document.body.appendChild(chip);

    // 表示制御
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

    field.addEventListener("focus", showChip);
    field.addEventListener("mouseenter", showChip);
    field.addEventListener("blur", hideChip);
    field.addEventListener("mouseleave", hideChip);

    field.dssiChipElement = chip;
}

// ---------------------------------------------
// Core Logic: 処理の実行
// ---------------------------------------------
async function processField(field) {
    if (field.dataset.dssiBound) return;
    
    // 1. フィールドタイプに応じた基本データを取得
    let chipData = getFieldConfig(field);
    if (!chipData) return; // 対象外なら何もしない

    field.dataset.dssiBound = "true";
    const protocol = window.location.protocol;

    // 2. HTTP判定 (全フィールド共通のリスク上書き)
    if (protocol === 'http:') {
        chipData.title = "⚠️ 技術情報: 非暗号化通信 (HTTP)";
        chipData.borderColor = "#e74c3c"; // 赤
        chipData.fact = "【事実】 このページの通信経路は暗号化されていません。";
        chipData.purpose = "【目的】 古いシステムの互換性維持、または設定ミスによりこの状態になっています。";
        chipData.risk = "【リスク】 経路上の第三者が、入力内容（" + field.type + "）を傍受可能です。";
        chipData.rec = "機密情報の入力は避け、VPNの使用や別経路での連絡を検討してください。";
        
        renderChip(field, chipData);
    
    } else if (protocol === 'https:') {
        // 3. HTTPS詳細判定 (バックグラウンド問い合わせ)
        try {
            chrome.runtime.sendMessage({
                type: "CHECK_CERTIFICATE",
                url: window.location.href
            }, (response) => {
                if (chrome.runtime.lastError) return;

                if (response && response.status === "expired") {
                    chipData.title = "🚫 技術情報: 証明書期限切れ";
                    chipData.borderColor = "#c0392b"; // 濃い赤
                    chipData.fact = `【事実】 証明書の期限が切れています (期限: ${response.expiry})。`;
                    chipData.purpose = "【状況】 管理不備、あるいは偽サイトの可能性があります。";
                    chipData.risk = "【リスク】 暗号化が機能していない可能性があります。";
                    chipData.rec = "直ちに利用を中止してください。";
                }
                renderChip(field, chipData);
            });
        } catch (e) {
            renderChip(field, chipData);
        }
    }
}

function attachChips() {
    const passwordFields = document.querySelectorAll(TARGET_SELECTORS);
    passwordFields.forEach(processField);
}

// ---------------------------------------------
// Control Logic & Entry Point (変更なし)
// ---------------------------------------------
function startGuard() {
    if (guardInterval) return;
    console.log("🛡️ DSSI Guard: Enabled.");
    attachChips();
    guardInterval = setInterval(attachChips, 2000);
}

function stopGuard() {
    if (!guardInterval && !document.querySelector('.dssi-observed-field')) return;
    console.log("🛡️ DSSI Guard: Disabled.");
    if (guardInterval) {
        clearInterval(guardInterval);
        guardInterval = null;
    }
    document.querySelectorAll('.dssi-chip').forEach(el => el.remove());
    document.querySelectorAll('.dssi-observed-field').forEach(field => {
        field.style.border = "";
        field.classList.remove("dssi-observed-field");
        delete field.dataset.dssiBound;
    });
}

chrome.storage.local.get(['dssiEnabled'], (result) => {
    if (result.dssiEnabled !== false) {
        startGuard();
    } else {
        console.log("🛡️ DSSI Guard: Starts in DISABLED mode.");
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TOGGLE_GUARD") {
        if (request.enabled) {
            startGuard();
        } else {
            stopGuard();
        }
    }
});