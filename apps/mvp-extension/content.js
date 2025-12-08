/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドの検知、技術的事実（チップス）の提示、危険な送信のブロック。
 * 機能: マルチターゲット検知、HTTP/HTTPS判定、バックグラウンド連携、ON/OFF制御、Submit Guard、送信フィードバック。
 * 哲学: "Facts over Fear."
 */

console.log("🛡️ DSSI Guard: Loaded.");

const TARGET_SELECTORS = 'input[type="password"], input[type="email"], input[name*="card"], input[name*="cc-"], input[id*="card"]';
let guardInterval = null;

// ---------------------------------------------
// Logic: フィールド定義
// ---------------------------------------------
function getFieldConfig(field) {
    const type = field.type;
    const name = (field.name || field.id || "").toLowerCase();

    if (type === "password") {
        return {
            title: "ℹ️ 技術情報: キー入力イベント",
            borderColor: "#e67e22",
            fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
            purpose: "【目的】 この技術は通常、利便性（入力補助など）のために使われます。",
            risk: "【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。",
            rec: "キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。"
        };
    }
    if (name.includes("card") || name.includes("cc-") || name.includes("cvc")) {
        return {
            title: "💳 技術情報: 決済情報の入力",
            borderColor: "#e67e22",
            fact: "【確認】 財務資産に直結する情報の入力欄です。",
            purpose: "【目的】 サービスや商品の購入決済に使用されます。",
            risk: "【リスク】 通信経路や保存方法に不備がある場合、資産の不正利用に直結します。",
            rec: "ブラウザのアドレスバーに「鍵マーク(HTTPS)」があるか、必ず再確認してください。"
        };
    }
    if (type === "email") {
        return {
            title: "📧 技術情報: 連絡先情報の入力",
            borderColor: "#3498db",
            fact: "【確認】 個人を特定、追跡可能なID（メールアドレス）の入力欄です。",
            purpose: "【目的】 連絡、認証、およびユーザーのトラッキング（追跡）に使用されます。",
            risk: "【リスク】 フィッシングサイトの場合、入力した時点でリスト化される可能性があります。",
            rec: "このサイトのドメイン（URL）が、意図した相手のものであるか確認してください。"
        };
    }
    return null;
}

// ---------------------------------------------
// Helper: 送信フィードバック (トースト表示) ★新規追加
// ---------------------------------------------
function showSubmissionToast(message) {
    const toast = document.createElement("div");
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #2c3e50;
        color: #fff;
        padding: 15px 25px;
        border-radius: 5px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        z-index: 2147483647;
        font-family: sans-serif;
        font-size: 14px;
        border-left: 5px solid #27ae60;
        opacity: 0;
        transition: opacity 0.3s;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);

    // フェードイン
    requestAnimationFrame(() => {
        toast.style.opacity = "1";
    });

    // 1.5秒後に消える（念のため）
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

// ---------------------------------------------
// Helper: チップスの描画
// ---------------------------------------------
function renderChip(field, data, isBlocker = false, blockerCallback = null) {
    if (field.dssiChipElement) field.dssiChipElement.remove();
    const existingBlocker = document.querySelector('.dssi-blocker-chip');
    if (existingBlocker) existingBlocker.remove();

    if (!isBlocker) {
        field.style.border = `2px solid ${data.borderColor}`;
        field.classList.add("dssi-observed-field");
    }

    const chip = document.createElement("div");
    chip.className = isBlocker ? "dssi-chip dssi-blocker-chip" : "dssi-chip";
    const leftBorderColor = (data.borderColor === "#e74c3c" || data.borderColor === "#c0392b") ? data.borderColor : data.borderColor;
    chip.style.borderLeft = `4px solid ${leftBorderColor}`;

    let btnHtml = "";
    if (isBlocker) {
        btnHtml = `
        <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:10px;">
            <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">送信をやめる</button>
            <button id="dssi-confirm-btn" style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">リスクを承知で送信</button>
        </div>`;
    }

    chip.innerHTML = `
        <span class="dssi-chip-title" style="color:${leftBorderColor === '#e67e22' ? '#f1c40f' : (leftBorderColor === '#3498db' ? '#3498db' : '#e74c3c')}">${data.title}</span>
        ${data.fact}<br>
        ${data.purpose}<br>
        ${data.risk}<br>
        <strong>推奨:</strong> ${data.rec}
        ${btnHtml}
    `;
    document.body.appendChild(chip);

    const updatePosition = () => {
        const rect = field.getBoundingClientRect();
        const scrollY = window.scrollY || window.pageYOffset;
        const scrollX = window.scrollX || window.pageXOffset;
        chip.style.top = `${rect.top + scrollY - chip.offsetHeight - 10}px`;
        chip.style.left = `${rect.left + scrollX}px`;
    };

    if (isBlocker) {
        updatePosition();
        chip.classList.add("dssi-visible");

        const confirmBtn = chip.querySelector("#dssi-confirm-btn");
        const cancelBtn = chip.querySelector("#dssi-cancel-btn");

        if (confirmBtn) {
            confirmBtn.addEventListener("click", (e) => {
                e.preventDefault();
                chip.remove();
                if (blockerCallback) blockerCallback(true);
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener("click", (e) => {
                e.preventDefault();
                chip.remove();
                if (blockerCallback) blockerCallback(false);
            });
        }

        const outsideClickListener = (e) => {
            if (!chip.contains(e.target) && e.target !== field) {
                chip.remove();
                document.removeEventListener("click", outsideClickListener);
            }
        };
        setTimeout(() => {
            document.addEventListener("click", outsideClickListener);
        }, 100);

    } else {
        const showChip = () => {
            updatePosition();
            chip.classList.add("dssi-visible");
        };
        const hideChip = () => {
            chip.classList.remove("dssi-visible");
        };
        field.addEventListener("focus", showChip);
        field.addEventListener("mouseenter", showChip);
        field.addEventListener("blur", hideChip);
        field.addEventListener("mouseleave", hideChip);
    }

    if (!isBlocker) field.dssiChipElement = chip;
}

// ---------------------------------------------
// Logic: フィールド処理
// ---------------------------------------------
async function processField(field) {
    if (field.dataset.dssiBound) return;
    
    let chipData = getFieldConfig(field);
    if (!chipData) return;

    field.dataset.dssiBound = "true";
    const protocol = window.location.protocol;

    if (protocol === 'http:') {
        chipData.title = "⚠️ 技術情報: 非暗号化通信 (HTTP)";
        chipData.borderColor = "#e74c3c";
        chipData.fact = "【事実】 このページの通信経路は暗号化されていません。";
        chipData.purpose = "【目的】 古いシステムの互換性維持、または設定ミスによりこの状態になっています。";
        chipData.risk = "【リスク】 経路上の第三者が、入力内容を傍受可能です。";
        chipData.rec = "機密情報の入力は避け、VPNの使用や別経路での連絡を検討してください。";
        renderChip(field, chipData);
    
    } else if (protocol === 'https:') {
        try {
            chrome.runtime.sendMessage({ type: "CHECK_CERTIFICATE", url: window.location.href }, (response) => {
                if (chrome.runtime.lastError) return;
                if (response && response.status === "expired") {
                    chipData.title = "🚫 技術情報: 証明書期限切れ";
                    chipData.borderColor = "#c0392b";
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
// Logic: Submit Guard (送信ブロック)
// ---------------------------------------------
function attachSubmitGuard() {
    document.addEventListener("submit", (e) => {
        const form = e.target;
        const protocol = window.location.protocol;
        
        if (protocol === 'https:') return;
        if (form.dataset.dssiAllowed === "true") return;

        e.preventDefault();
        e.stopPropagation();

        const submitBtn = e.submitter || form.querySelector('button[type="submit"], input[type="submit"]');

        if (submitBtn) {
            renderChip(submitBtn, {
                title: "🛑 送信ブロック: 非暗号化通信",
                borderColor: "#e74c3c",
                fact: "【警告】 このフォームは暗号化されていない経路(HTTP)で送信されようとしています。",
                purpose: "【DSSI介入】 意図しない情報漏洩を防ぐため、送信を一時停止しました。",
                risk: "【リスク】 送信内容は平文で流れるため、盗聴されるリスクが極めて高いです。",
                rec: "本当に送信してよければ、「リスクを承知で送信」を押してください。"
            }, true, (isConfirmed) => {
                // コールバック関数
                if (isConfirmed) {
                    // ★ フィードバック表示（トースト）
                    const inputVal = form.querySelector("input")?.value || "(入力なし)";
                    // セキュリティのため、長い場合は省略
                    const displayVal = inputVal.length > 20 ? inputVal.substring(0, 20) + "..." : inputVal;
                    
                    showSubmissionToast(`✅ 送信を受け付けました。\n内容: ${displayVal}`);

                    // 1秒後に送信実行
                    setTimeout(() => {
                        form.dataset.dssiAllowed = "true";
                        if (form.requestSubmit) {
                            form.requestSubmit(submitBtn);
                        } else {
                            form.submit();
                        }
                    }, 1000);
                } else {
                    console.log("DSSI: User canceled submission.");
                }
            });
        } else {
            if(confirm("【DSSI警告】\n暗号化されていない通信(HTTP)で送信しようとしています。\n盗聴のリスクがあります。本当に送信しますか？")) {
                form.dataset.dssiAllowed = "true";
                form.submit();
            }
        }
    }, true);
}

// ---------------------------------------------
// Control Logic & Entry Point
// ---------------------------------------------
function startGuard() {
    if (guardInterval) return;
    console.log("🛡️ DSSI Guard: Enabled.");
    attachChips();
    attachSubmitGuard();
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