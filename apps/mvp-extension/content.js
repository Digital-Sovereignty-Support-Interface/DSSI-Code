/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドを検知し、技術的事実（チップス）を提示する。
 * 哲学: "Facts over Fear." (恐怖ではなく事実を)
 */

console.log("🛡️ DSSI Guard: Loaded.");

//const TARGET_SELECTORS = 'input';
//【for test】 : すべての入力欄に設定http://example.com/　にてallow pastingを行い、
//　document.body.innerHTML += '<input type="password" placeholder="DSSI Test Field" style="display:block; margin:20px auto; padding:10px; border:1px solid #ccc;">';
//　として、架空のパスワードフィールドを追加して動作確認可能
const TARGET_SELECTORS = 'input[type="password"]';
let guardInterval = null;

// ---------------------------------------------
// Core Logic: 事実の抽出 (Fact Extraction)
// ---------------------------------------------

function getProtocolFact() {
    const protocol = window.location.protocol;
    if (protocol === 'http:') {
        return {
            isSecure: false,
            title: "⚠️ 技術情報: 非暗号化通信 (HTTP)",
            fact: "【事実】 このページの通信経路は暗号化されていません。",
            risk: "【リスク】 同じネットワーク利用者や経路上の第三者が、内容を傍受・改ざん可能です。",
            recommendation: "機密情報の入力は避け、VPNの使用や別経路での連絡を検討してください。"
        };
    } else {
        return {
            isSecure: true,
            title: "ℹ️ 技術情報: キー入力イベント",
            fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
            risk: "【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。",
            recommendation: "キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。"
        };
    }
}

function attachChips() {
    const passwordFields = document.querySelectorAll(TARGET_SELECTORS);
    const protocolInfo = getProtocolFact();
    
    passwordFields.forEach((field) => {
        if (field.dataset.dssiBound) return;
        field.dataset.dssiBound = "true";

        // 1. 視覚的マーキング (HTTPなら赤、HTTPSならオレンジ)
        const borderColor = protocolInfo.isSecure ? "#e67e22" : "#e74c3c";
        field.style.border = `2px solid ${borderColor}`;
        field.classList.add("dssi-observed-field");

        // 2. チップスの生成 (文言の動的生成)
        const chip = document.createElement("div");
        chip.className = "dssi-chip";
        
        // HTTPの場合、より警告色を強めるスタイルを追加
        if (!protocolInfo.isSecure) {
            chip.style.borderLeft = "4px solid #e74c3c";
        }

        chip.innerHTML = `
            <span class="dssi-chip-title" style="color: ${protocolInfo.isSecure ? '#f1c40f' : '#e74c3c'}">${protocolInfo.title}</span>
            ${protocolInfo.fact}<br>
            ${protocolInfo.isSecure ? 
                `【目的】 この技術は通常、利便性のために使われます。<br>` : 
                `【目的】 古いシステムの互換性維持、または設定ミスによりこの状態になっています。<br>`
            }
            ${protocolInfo.risk}<br>
            <strong>推奨:</strong> ${protocolInfo.recommendation}
        `;
        document.body.appendChild(chip);

        // 3. 表示制御
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
    });
}

// ---------------------------------------------
// Control Logic & Entry Point
// ---------------------------------------------
// (前回のON/OFF機能と同じため、変更なし。そのまま維持)

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
        field.style.border = ""; // スタイルをリセット
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
