/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドの検知、技術的事実（チップス）の提示、危険な送信のブロック。
 * 機能: マルチターゲット検知、HTTP/HTTPS判定、バックグラウンド連携、ON/OFF制御、Submit Guard。
 * 拡張: 粘性レベル制御 (Revised Logic)、枠線永続化、ホバー安定化、自動復活、リアルタイムリセット。
 * 哲学: "Facts over Fear." / "We do not substitute your thought."
 */

console.log("🛡️ DSSI Guard: Loaded.");

// 監視対象定義
const SELECTORS_ALL = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea';
const SELECTORS_CORE = 'input[type="password"], input[type="email"], input[name*="email"], input[id*="email"], input[name*="user"], input[id*="user"], input[name*="login"], input[id*="login"], input[name*="account"], input[id*="account"], input[name*="card"], input[name*="cc-"], input[id*="card"]';

let guardInterval = null;
let currentLevel = 2; // デフォルト標準

// ★ リスクレベル定義 (ユーザー意図に合わせて再定義)
// Level N を選択したとき、Risk N 以下のものを表示する
const RISK_CRITICAL = 0; // 問答無用 (HTTP/CertError) -> Lv1でも表示
const RISK_HIGH     = 2; // パスワード/決済 -> Lv2以上で表示
const RISK_MID      = 3; // ID/Email -> Lv3以上で表示
const RISK_LOW      = 3; // 汎用 -> Lv3以上で表示

// ---------------------------------------------
// Logic: ストレージ操作 (変更なし)
// ---------------------------------------------
const STORAGE_KEY_STATS = 'dssi_stats';
const MUTE_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30日(30d*24h*60m*60s*1000ms) 
async function getChipStats(chipId) {
    return new Promise((resolve) => {
        if (!chrome.runtime?.id) return resolve({ count: 0, muted: false, lastMutedAt: null });
        chrome.storage.local.get([STORAGE_KEY_STATS], (result) => {
            const stats = result[STORAGE_KEY_STATS] || {};
            const item = stats[chipId] || { count: 0, muted: false, lastMutedAt: null };

            if (item.muted && item.lastMutedAt) {
                const elapsed = Date.now() - item.lastMutedAt;
                if (elapsed > MUTE_EXPIRATION_MS) {
                    item.muted = false;
                    item.lastMutedAt = null;
                    stats[chipId] = item;
                    chrome.storage.local.set({ [STORAGE_KEY_STATS]: stats });
                    console.log(`DSSI: Auto-unmuted guide for ${chipId} (Expired)`);
                }
            }
            resolve(item);
        });
    });
}

async function updateChipStats(chipId, changes) {
    return new Promise((resolve) => {
        if (!chrome.runtime?.id) return;
        chrome.storage.local.get([STORAGE_KEY_STATS], (result) => {
            const stats = result[STORAGE_KEY_STATS] || {};
            const current = stats[chipId] || { count: 0, muted: false, lastMutedAt: null };
            
            if (changes.increment) current.count++;
            if (changes.mute !== undefined) {
                current.muted = changes.mute;
                if (changes.mute) current.lastMutedAt = Date.now(); 
            }
            
            stats[chipId] = current;
            chrome.storage.local.set({ [STORAGE_KEY_STATS]: stats }, resolve);
        });
    });
}

// ---------------------------------------------
// Logic: フィールド定義とリスクランク (数値化)
// ---------------------------------------------
function getFieldConfig(field) {
    const type = (field.type || "").toLowerCase();
    const name = (field.name || field.id || "").toLowerCase();

    // A. パスワード (HIGH: 2)
    if (type === "password") {
        return {
            id: "guide_password",
            riskLevel: RISK_HIGH,
            title: "ℹ️ 技術情報: キー入力イベント",
            borderColor: "#e67e22", // オレンジ
            fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
            purpose: "【目的】 この技術は通常、利便性（入力補助など）のために使われます。",
            risk: "【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。",
            rec: "キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。"
        };
    }
    
    // B. クレジットカード (HIGH: 2)
    if (name.includes("card") || name.includes("cc-") || name.includes("cvc")) {
        return {
            id: "guide_credit_card",
            riskLevel: RISK_HIGH,
            title: "💳 技術情報: 決済情報の入力",
            borderColor: "#e74c3c", // 赤
            fact: "【確認】 財務資産に直結する情報の入力欄です。",
            purpose: "【目的】 サービスや商品の購入決済に使用されます。",
            risk: "【リスク】 通信経路や保存方法に不備がある場合、資産の不正利用に直結します。",
            rec: "ブラウザのアドレスバーに「鍵マーク(HTTPS)」があるか、必ず再確認してください。"
        };
    }

    // C. メールアドレス/ID (MID: 3)
    if (type === "email" || name.includes("email") || name.includes("mail") || name.includes("user") || name.includes("login") || name.includes("account")) {
        return {
            id: "guide_email",
            riskLevel: RISK_MID,
            title: "📧 技術情報: 連絡先情報の入力",
            borderColor: "#2ecc71", // 緑
            fact: "【確認】 個人を特定、追跡可能なID（メールアドレス）の入力欄です。",
            purpose: "【目的】 連絡、認証、およびユーザーのトラッキング（追跡）に使用されます。",
            risk: "【リスク】 フィッシングサイトの場合、入力した時点でリスト化される可能性があります。",
            rec: "このサイトのドメイン（URL）が、意図した相手のものであるか確認してください。"
        };
    }

    // D. 汎用入力 (LOW: 3) - Level 3で表示
    // ★修正: if文を削除し、常に定義を返す（表示判定は shouldMonitor で行うため）
    return {
        id: "guide_general",
        riskLevel: RISK_LOW,
        title: "📝 技術情報: 一般入力フィールド",
        borderColor: "#5dade2", // 薄い水色
        fact: "【確認】 汎用的な情報の入力欄です。",
        purpose: "【目的】 検索、コメント、その他のデータ送信に使用されます。",
        risk: "【リスク】 些細な情報でも、組み合わせることで個人の特定や行動追跡に利用される可能性があります。",
        rec: "不要な個人情報の入力を避けてください。"
    };
}

// ---------------------------------------------
// Logic: 監視対象判定 (数値ロジック)
// ---------------------------------------------
function shouldMonitor(riskLevel) {
    // ユーザーレベルがリスクレベル以上なら表示
    // Lv1 >= 0(Critical) -> True
    // Lv1 >= 2(High) -> False (これでPass/Cardは消える)
    return currentLevel >= riskLevel;
}

// ---------------------------------------------
// Helper: 送信フィードバック
// ---------------------------------------------
function showSubmissionToast(message) {
    const toast = document.createElement("div");
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background-color: #2c3e50; color: #fff; padding: 15px 25px;
        border-radius: 5px; z-index: 2147483647; font-size: 14px;
        border-left: 5px solid #27ae60; opacity: 0; transition: opacity 0.3s; pointer-events: none;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

// ---------------------------------------------
// Helper: 全チップスの物理消去
// ---------------------------------------------
function hideAllChips() {
    document.querySelectorAll('.dssi-chip').forEach(chip => {
        if (!chip.classList.contains('dssi-blocker-chip')) {
            chip.style.display = 'none';
            chip.classList.remove("dssi-visible");
        }
    });
}

// ---------------------------------------------
// Helper: チップスの描画
// ---------------------------------------------
function renderChip(field, data, isBlocker = false, blockerCallback = null, stats = null) {
    if (field.dssiChipElement) {
        field.dssiChipElement.remove();
        field.dssiChipElement = null;
    }
    if (isBlocker) {
        const existingBlocker = document.querySelector('.dssi-blocker-chip');
        if (existingBlocker) existingBlocker.remove();
    }

    if (data.borderColor === "#e74c3c" && !data.id) { 
        field.classList.add("dssi-danger-field");
    }
    if (!isBlocker) {
        field.style.border = `2px solid ${data.borderColor}`;
        field.classList.add("dssi-observed-field");
    }

    // ★重要: 表示対象外（レベル不足）なら枠線も消して帰る
    if (!isBlocker && !shouldMonitor(data.riskLevel)) {
        field.style.border = "";
        field.classList.remove("dssi-observed-field");
        return;
    }

    if (stats && stats.muted) return;

    const chip = document.createElement("div");
    chip.className = isBlocker ? "dssi-chip dssi-blocker-chip" : "dssi-chip";
    const leftBorderColor = (data.borderColor === "#e74c3c" || data.borderColor === "#c0392b") ? data.borderColor : data.borderColor;
    chip.style.borderLeft = `4px solid ${leftBorderColor}`;
    
    if (!isBlocker) chip.style.display = 'none';
    chip.style.pointerEvents = "auto";

    let btnHtml = "";
    let footerHtml = "";

// renderChip 関数内のボタン生成部分の修正案

    if (isBlocker) {
        // 内容保護シールド（Shield）か、通信ブロック（HTTP）かでボタンを出し分ける
        const isShieldMode = data.title.includes("保護"); // タイトルで判定（簡易的）

        btnHtml = `
        <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
            <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">やめる</button>
            ${isShieldMode ? `
                <button id="dssi-raw-btn" style="padding:6px 12px; background:#7f8c8d; color:white; border:none; border-radius:3px; cursor:pointer;">原文のまま送信</button>
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#3498db; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">🛡️ 保護して送信</button>
            ` : `
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">リスクを承知で送信</button>
            `}
        </div>`;
    } else if (stats) {
        footerHtml = `
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.2); display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#bdc3c7;">
            <span>表示回数: ${stats.count}</span>
            <button id="dssi-mute-btn" style="background:transparent; border:1px solid #7f8c8d; color:#bdc3c7; border-radius:3px; cursor:pointer; padding:2px 5px; font-size:10px;">今後表示しない</button>
        </div>
        `;
    }
    
    // if (isBlocker) {
    //     btnHtml = `
    //     <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:10px;">
    //         <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">送信をやめる</button>
    //         <button id="dssi-confirm-btn" style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">リスクを承知で送信</button>
    //     </div>`;
    // } else if (stats) {
    //     footerHtml = `
    //     <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.2); display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#bdc3c7;">
    //         <span>表示回数: ${stats.count}</span>
    //         <button id="dssi-mute-btn" style="background:transparent; border:1px solid #7f8c8d; color:#bdc3c7; border-radius:3px; cursor:pointer; padding:2px 5px; font-size:10px;">今後表示しない</button>
    //     </div>
    //     `;
    // }

    chip.innerHTML = `
        <span class="dssi-chip-title" style="color:${leftBorderColor === '#e67e22' ? '#f1c40f' : (leftBorderColor === '#3498db' ? '#3498db' : (leftBorderColor === '#2ecc71' ? '#2ecc71' : (leftBorderColor === '#5dade2' ? '#5dade2' : '#e74c3c')))}">${data.title}</span>
        ${data.fact}<br>
        ${data.purpose}<br>
        ${data.risk}<br>
        <strong>推奨:</strong> ${data.rec}
        ${footerHtml}
        ${btnHtml}
    `;
    document.body.appendChild(chip);

    const updatePosition = () => {
        const rect = field.getBoundingClientRect();
        const scrollY = window.scrollY || window.pageYOffset;
        const scrollX = window.scrollX || window.pageXOffset;
        let top = rect.top + scrollY - chip.offsetHeight - 10;
        if (top < scrollY) top = rect.bottom + scrollY + 10;
        chip.style.top = `${top}px`;
        chip.style.left = `${rect.left + scrollX}px`;
    };

    const cleanupFns = [];

    if (isBlocker) {
        updatePosition();
        chip.classList.add("dssi-visible");
        
        const confirmBtn = chip.querySelector("#dssi-confirm-btn");
        const cancelBtn = chip.querySelector("#dssi-cancel-btn");
        
        if (confirmBtn) {
            const h = (e) => { e.preventDefault(); chip.remove(); if (blockerCallback) blockerCallback(true); };
            confirmBtn.addEventListener("click", h);
        }
        if (cancelBtn) {
            const h = (e) => { e.preventDefault(); chip.remove(); if (blockerCallback) blockerCallback(false); };
            cancelBtn.addEventListener("click", h);
        }
        
        const outsideClickListener = (e) => {
            if (!chip.contains(e.target) && e.target !== field) {
                chip.remove();
                document.removeEventListener("click", outsideClickListener);
            }
        };
        setTimeout(() => document.addEventListener("click", outsideClickListener), 100);

    } else {
        let hoverTimeout;
        let isHovering = false;

        const showChip = () => {
            isHovering = true;
            if (hoverTimeout) clearTimeout(hoverTimeout);
            hideAllChips();
            chip.style.display = 'block';
            updatePosition();
            requestAnimationFrame(() => chip.classList.add("dssi-visible"));
        };

        const scheduleHide = () => {
            isHovering = false;
            if (hoverTimeout) clearTimeout(hoverTimeout);
            
            hideTimeout = setTimeout(() => {
                if (!isHovering) {
                    chip.classList.remove("dssi-visible");
                    setTimeout(() => {
                        if (!isHovering && !chip.classList.contains("dssi-visible")) {
                            chip.style.display = 'none';
                        }
                    }, 300);
                }
            }, 600);
        };
        
        const keepChip = () => {
            isHovering = true;
            if (hoverTimeout) clearTimeout(hoverTimeout);
        };

        field.addEventListener("focus", showChip);
        field.addEventListener("blur", scheduleHide);
        field.addEventListener("mouseenter", showChip);
        field.addEventListener("mouseleave", scheduleHide);
        chip.addEventListener("mouseenter", keepChip);
        chip.addEventListener("mouseleave", scheduleHide);

        cleanupFns.push(() => {
            field.removeEventListener("focus", showChip);
            field.removeEventListener("blur", scheduleHide);
            field.removeEventListener("mouseenter", showChip);
            field.removeEventListener("mouseleave", scheduleHide);
        });

        const muteBtn = chip.querySelector("#dssi-mute-btn");
        if (muteBtn) {
            muteBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                updateChipStats(data.id, { mute: true });
                chip.remove();
                field.dataset.dssiBound = "muted";
            });
        }
    }

    if (!isBlocker) {
        field.dssiChipElement = chip;
        field.dssiCleanup = () => {
            cleanupFns.forEach(fn => fn());
        };
    }
}

// ---------------------------------------------
// Logic: フィールド処理
// ---------------------------------------------
async function processField(field) {
    // アクティブなフィールドもレベル変更で対象外になる可能性があるため、チェックを通過させる
    // if (field.dataset.dssiBound === "active") return; 
    
    let chipData = getFieldConfig(field);
    if (!chipData) return;

    const protocol = window.location.protocol;
    if (protocol === 'http:') {
        chipData.riskLevel = RISK_CRITICAL; // HTTPは問答無用でレベル0
    }

    // ★ レベル判定 (renderChip内でも行うが、ここでも事前チェック)
    if (!shouldMonitor(chipData.riskLevel)) {
        if (field.dssiChipElement) {
            field.dssiChipElement.remove();
            field.dssiChipElement = null;
        }
        field.style.border = "";
        field.classList.remove("dssi-observed-field");
        // datasetは消さないと、レベルを上げた時に再検知されない？
        // -> resetGuards で dssiBound は消されるのでOK
        return;
    }

    if (field.dataset.dssiBound === "active") return; // 既にアクティブならスキップ

    if (chipData.id) {
        const stats = await getChipStats(chipData.id);
        if (stats.muted) {
            field.dataset.dssiBound = "muted";
            field.style.border = `2px solid ${chipData.borderColor}`;
            field.classList.add("dssi-observed-field");
            return;
        } else {
            if (field.dataset.dssiBound !== "active") {
                await updateChipStats(chipData.id, { increment: true });
                chipData.stats = { count: stats.count + 1 };
            } else {
                chipData.stats = { count: stats.count };
            }
        }
    }

    field.dataset.dssiBound = "active";

    if (protocol === 'http:') {
        chipData.title = "⚠️ 技術情報: 非暗号化通信 (HTTP)";
        chipData.borderColor = "#e74c3c";
        chipData.fact = "【事実】 このページの通信経路は暗号化されていません。";
        chipData.purpose = "【目的】 古いシステムの互換性維持、または設定ミスによりこの状態になっています。";
        chipData.risk = "【リスク】 経路上の第三者が、入力内容を傍受可能です。";
        chipData.rec = "機密情報の入力は避け、VPNの使用や別経路での連絡を検討してください。";
        chipData.stats = null; 
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
                    chipData.stats = null;
                }
                renderChip(field, chipData, false, null, chipData.stats);
            });
        } catch (e) {
            renderChip(field, chipData, false, null, chipData.stats);
        }
    }
}

// ---------------------------------------------
// Logic: 監視対象判定 (数値ロジック)
// ---------------------------------------------
function shouldMonitor(riskLevel) {
    return currentLevel >= riskLevel;
}

function attachChips() {
    const selector = (currentLevel >= 3) ? SELECTORS_ALL : SELECTORS_CORE;
    const fields = document.querySelectorAll(selector);
    fields.forEach(processField);
}

// 本来は chrome.storage から読み込むのが理想的
const MY_SECRETS = {
    "清水克敏": "[PERSON_A]",
    "清水": "[PERSON_B]",
    "清水 克敏": "[PERSON_C]",
    "清水　克敏": "[PERSON_D]",
    "O.A.E.株式会社": "[COMPANY_RED]"
};

/**
 * 精緻化された applyShield：固有名詞などの伏せ字化
 * @param {string} text - 原文
 * @returns {object} - { shieldedText: 加工後, mapping: 復元用辞書, count: 件数 }
 */
function applyShield(text) {
    let shieldedText = text;
    let mapping = {};
    let count = 0;

    // 1. 自動検知（正規表現）: メール、電話番号、URLなど
    const patterns = {
        EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        PHONE: /\d{2,4}-\d{2,4}-\d{4}/g,
        // 必要に応じて郵便番号なども追加
    };

    for (const [type, reg] of Object.entries(patterns)) {
        shieldedText = shieldedText.replace(reg, (match) => {
            count++;
            return `[${type}_${count}]`;
        });
    }

    // 2. ユーザー定義辞書（MY_SECRETS）による高精度置換
    // マスターが登録した「絶対に漏らしたくない固有名詞」
    for (const [realName, placeholder] of Object.entries(MY_SECRETS)) {
        const escaped = realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'g');
        const matches = shieldedText.match(re);
        if (matches) {
            count += matches.length;
            shieldedText = shieldedText.replace(re, placeholder);
        }
    }

    return { shieldedText, count };
}

// ... (resetGuards以降は変更なし)
function resetGuards() {
    console.log("🛡️ DSSI Guard: Resetting...");
    document.querySelectorAll('.dssi-chip').forEach(el => el.remove());
    document.querySelectorAll('.dssi-observed-field').forEach(field => {
        if (field.dssiCleanup) {
            field.dssiCleanup();
            field.dssiCleanup = null;
        }
        if (field.dssiChipElement) {
            field.dssiChipElement.remove();
            field.dssiChipElement = null;
        }
        field.style.border = "";
        field.classList.remove("dssi-observed-field");
        field.classList.remove("dssi-danger-field");
        delete field.dataset.dssiBound;
    });
    setTimeout(() => {
        console.log("🛡️ DSSI Guard: Rescanning now.");
        attachChips();
    }, 100);
}

/**
 * 内容保護シールド（Content-Aware Shield）
 * 責務: 送信内容をスキャンし、機密情報の伏せ字化と確認を促す
 */
function attachContentShield() {
    // GeminiやChatGPTなどの「ボタン」を直接監視（submitイベントが発生しないため）
    const sendBtn = document.querySelector('button[aria-label="プロンプトを送信"], button[data-testid="send-button"]');
    
    if (sendBtn && !sendBtn.dataset.shieldBound) {
        sendBtn.dataset.shieldBound = "true";
        
        sendBtn.addEventListener('click', (e) => {
            // すでにシールド確認済みの場合はスルー
            if (sendBtn.dataset.shieldVerified === "true") {
                sendBtn.dataset.shieldVerified = "false";
                return;
            }

            const inputField = document.querySelector('div[contenteditable="true"], textarea');
            const rawText = inputField ? (inputField.innerText || inputField.value) : "";
            
            // 🛡️ 伏せ字処理を実行
            const { shieldedText, replacedCount } = applyShield(rawText);

            // 伏せ字が発生した、あるいはレベル3(主権)の場合は確認を出す
            if (replacedCount > 0 || currentLevel === 3) {
                e.preventDefault();
                e.stopPropagation();

                renderChip(sendBtn, {
                    title: "🛡️ DSSI 内容保護シールド",
                    borderColor: "#3498db",
                    fact: `${replacedCount} 件の機密情報を [MASK] に置換しました。`,
                    purpose: "【情報搾取の防止】 外部AIへの実名・固有名詞の送信を制限しています。",
                    risk: "実名を送るとGoogleの学習データやレビュアーの閲覧対象になるリスクがあります。",
                    rec: "保護された内容で送信してよければ「承認」を、原文のまま送るなら「解除」を選択してください。"
                }, true, (isConfirmed) => {
                    if (isConfirmed) {
                        // 伏せ字を適用して送信
                        if (inputField) {
                            if (inputField.tagName === 'DIV') inputField.innerText = shieldedText;
                            else inputField.value = shieldedText;
                        }
                        sendBtn.dataset.shieldVerified = "true";
                        sendBtn.click();
                    }
                });
            }
        }, true); // Captureモードでイベントを先取りする
    }
}

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
                if (isConfirmed) {
                    const inputVal = form.querySelector("input")?.value || "(入力なし)";
                    const displayVal = inputVal.length > 20 ? inputVal.substring(0, 20) + "..." : inputVal;
                    showSubmissionToast(`✅ 送信を受け付けました。\n内容: ${displayVal}`);
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

function startGuard() {
    if (guardInterval) return;
    console.log("🛡️ DSSI Guard: Enabled.");
    attachChips();
    attachSubmitGuard();   // 既存: HTTP警告
    attachContentShield(); // 新設: 内容保護
    guardInterval = setInterval(() => {
        attachChips();
        attachContentShield(); // Geminiなどは動的に要素が変わるので定期監視
    }, 2000);
}

// function startGuard() {
//     if (guardInterval) return;
//     console.log("🛡️ DSSI Guard: Enabled.");
//     attachChips();
//     attachSubmitGuard();
//     guardInterval = setInterval(attachChips, 2000);
// }

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

chrome.storage.local.get(['dssiEnabled', 'dssiLevel'], (result) => {
    currentLevel = result.dssiLevel || 2;
    console.log(`🛡️ DSSI Level: ${currentLevel}`);
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
    if (request.action === "RESET_GUARD") {
        resetGuards();
    }
    if (request.action === "UPDATE_SETTINGS") {
        if (request.level !== undefined) {
            currentLevel = request.level;
            console.log(`🛡️ DSSI Level Updated: ${currentLevel}`);
            resetGuards(); 
        }
        if (request.enabled !== undefined) {
            request.enabled ? startGuard() : stopGuard();
        }
    }
});