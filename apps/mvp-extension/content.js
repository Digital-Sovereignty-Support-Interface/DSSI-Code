/**
 * DSSI Content Script (Observer & Guide) v2.1
 * Refactored: Garbage Collection & Structural Integrity Check
 */

// ==========================================
// 0. 初期化 & スタイル注入
// ==========================================
(function() {
    const style = document.createElement('style');
    style.textContent = `
        /* 復元された文字のスタイル */
        .dssi-unmasked {
            color: #00d1b2 !important;
            border-bottom: 2px dashed #00d1b2 !important;
            background-color: rgba(0, 209, 178, 0.1) !important;
            font-weight: bold !important;
            padding: 0 2px !important;
            border-radius: 3px !important;
            cursor: help !important;
        }
        /* ポップアップ用 */
        #dssi-chip {
            z-index: 9999 !important;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
        }
        .dssi-chip-title { font-weight: bold; display: block; margin-bottom: 5px; }
        .dssi-danger-field { box-shadow: 0 0 5px rgba(231, 76, 60, 0.5); }
    `;
    document.head.appendChild(style);
    console.log("🛡️ DSSI Styles Injected.");
})();
console.log("🛡️ DSSI Guard: Loaded.");

// ==========================================
// 1. 通信観測・分析層 (The Probe & Announcer)
// ==========================================
const DSSI_PROBE = {
    flags: { fetchUsed: false, xhrUsed: false, binaryDetected: false }
};

// --- 通信技術アナウンス定義 ---
const DSSI_ANNOUNCER = {
    select() {
        const f = DSSI_PROBE.flags;
        const base = {
            risk: "【リスク】 画面書き換え後に通信が発生しますが、技術構成によっては書き換え前のデータが送信される「検証の空白」が生じる可能性があります。",
            rec: "送信直後の検証結果を必ず確認してください。もし検証不能と出た場合は、その通信はDSSIの保護対象外です。"
        };

        if (f.binaryDetected) return {
            ...base,
            title: "⚡ 技術情報: 高度符号化通信",
            fact: "【事実】 バイナリ通信を検知。DOMの書き換えが通信に反映されないリスクが高い状態です。",
            purpose: "【目的】 効率的なデータ転送のため、ブラウザの表示層をバイパスして送信されることがあります。"
        };

        return {
            ...base,
            title: "ℹ️ 技術情報: 標準通信",
            fact: "【事実】 標準的な通信を検知。DOM書き換えによる伏せ字化が有効である可能性が高いです。",
            purpose: "【目的】 汎用的なプロトコルによる、透明性の高い通信状態です。"
        };
    }
};

// --- 送信直後の検証アルゴリズム ---
function validateDssiEffect() {
    // 1.5秒待機し、Geminiのチャットログ（送信済みバブル）がDOMに現れるのを待つ
    setTimeout(() => {
        const userBubbles = document.querySelectorAll('[data-message-author-role="user"], .query-text, .conversation-item--user');
        if (userBubbles.length > 0) {
            const lastMsgNode = userBubbles[userBubbles.length - 1];
            const lastMsgText = lastMsgNode.innerText;
            
            // アルゴリズムによる検証
            const isMasked = lastMsgText.includes('[FOOD') || lastMsgText.includes('[TEST_');
            
            if (isMasked) {
                showStatusNotification("✅ 検証成功: 送信ログに伏せ字の適用を確認しました。");
            } else {
                showStatusNotification("⚠️ 警告: 伏せ字が適用されていません。技術的なバイパスが発生した可能性があります。");
            }
        } else {
            // ログが見つからない＝検証できないという事実の提示
            showStatusNotification("❓ 検証不能: 通信ログを画面上から取得できませんでした。保護が有効だったかは不明です。");
        }
    }, 1500);
}

// --- 通信フック (Sensor) ---
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    DSSI_PROBE.flags.fetchUsed = true;
    if (args[1]?.body instanceof Uint8Array || args[1]?.body instanceof ArrayBuffer) {
        DSSI_PROBE.flags.binaryDetected = true;
    }
    return originalFetch(...args);
};

const originalXHR = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function(method, url) {
    DSSI_PROBE.flags.xhrUsed = true;
    const originalSend = this.send;
    this.send = function(data) {
        if (data instanceof ArrayBuffer || data instanceof Blob) {
            DSSI_PROBE.flags.binaryDetected = true;
        }
        return originalSend.apply(this, arguments);
    };
    return originalXHR.apply(this, arguments);
};

// ==========================================
// 2. 設定・辞書定義
// ==========================================
const SELECTORS_ALL = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea';
const SELECTORS_CORE = 'input[type="password"], input[type="email"], input[name*="email"], input[id*="email"], input[name*="user"], input[id*="user"], input[name*="login"], input[id*="login"], input[name*="account"], input[id*="account"], input[name*="card"], input[name*="cc-"], input[id*="card"]';

// リスクレベル定義
const RISK_CRITICAL = 0; 
const RISK_HIGH     = 2; 
const RISK_MID      = 3; 
const RISK_LOW      = 3; 

let guardInterval = null;
let currentLevel = 2; // デフォルト

const MY_SECRETS = {
    "クリエイター": "[TEST_MASK]",
    "人工呼吸": "[FOOF001]",
    "双子": "[FOOD002]",
    "清水克敏": "[PERSON_A]",
    "清水": "[PERSON_B]",
    "清水 克敏": "[PERSON_C]",
    "清水　克敏": "[PERSON_D]",
    "O.A.E.株式会社": "[COMPANY_RED]"
};

// ==========================================
// 3. ストレージ管理ロジック
// ==========================================
const STORAGE_KEY_STATS = 'dssi_stats';
const MUTE_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

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

// ==========================================
// 4. フィールド・リスク判定ロジック
// ==========================================
function getFieldConfig(field) {
    const type = (field.type || "").toLowerCase();
    const name = (field.name || field.id || "").toLowerCase();

    if (type === "password") {
        return {
            id: "guide_password",
            riskLevel: RISK_HIGH,
            title: "ℹ️ 技術情報: キー入力イベント",
            borderColor: "#e67e22",
            fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
            purpose: "【目的】 利便性（入力補助など）のために使われます。",
            risk: "【リスク】 悪用されると入力内容を盗み見（キーロガー）可能です。",
            rec: "パスワードマネージャーからの貼付けを推奨します。"
        };
    }
    if (name.includes("card") || name.includes("cc-") || name.includes("cvc")) {
        return {
            id: "guide_credit_card",
            riskLevel: RISK_HIGH,
            title: "💳 技術情報: 決済情報の入力",
            borderColor: "#e74c3c",
            fact: "【確認】 財務資産に直結する情報の入力欄です。",
            purpose: "【目的】 サービスや商品の購入決済に使用されます。",
            risk: "【リスク】 通信不備がある場合、資産の不正利用に直結します。",
            rec: "アドレスバーの鍵マーク(HTTPS)を確認してください。"
        };
    }
    if (type === "email" || name.includes("email") || name.includes("mail") || name.includes("user") || name.includes("login") || name.includes("account")) {
        return {
            id: "guide_email",
            riskLevel: RISK_MID,
            title: "📧 技術情報: 連絡先情報の入力",
            borderColor: "#2ecc71",
            fact: "【確認】 個人を特定、追跡可能なIDの入力欄です。",
            purpose: "【目的】 連絡、認証、および追跡に使用されます。",
            risk: "【リスク】 フィッシングの場合、入力した時点でリスト化されます。",
            rec: "ドメイン（URL）が意図した相手か確認してください。"
        };
    }
    return {
        id: "guide_general",
        riskLevel: RISK_LOW,
        title: "📝 技術情報: 一般入力フィールド",
        borderColor: "#5dade2",
        fact: "【確認】 汎用的な情報の入力欄です。",
        purpose: "【目的】 検索、コメント、その他のデータ送信に使用されます。",
        risk: "【リスク】 些細な情報も個人の特定に利用される可能性があります。",
        rec: "不要な個人情報の入力を避けてください。"
    };
}

function shouldMonitor(riskLevel) {
    return currentLevel >= riskLevel;
}

// ==========================================
// 5. UI描画・インタラクション (Chip Renderer)
// ==========================================
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

function hideAllChips() {
    document.querySelectorAll('.dssi-chip').forEach(chip => {
        if (!chip.classList.contains('dssi-blocker-chip')) {
            chip.style.display = 'none';
            chip.classList.remove("dssi-visible");
        }
    });
}

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

    if (!isBlocker && !shouldMonitor(data.riskLevel)) {
        field.style.border = "";
        field.classList.remove("dssi-observed-field");
        return;
    }

    if (stats && stats.muted) return;

    const chip = document.createElement("div");
    chip.className = isBlocker ? "dssi-chip dssi-blocker-chip" : "dssi-chip";
    const leftBorderColor = data.borderColor;
    chip.style.borderLeft = `4px solid ${leftBorderColor}`;
    
    if (!isBlocker) chip.style.display = 'none';
    chip.style.pointerEvents = "auto";

    // ボタン構築
    let btnHtml = "";
    if (isBlocker) {
        const isShieldMode = data.title.includes("保護") || data.title.includes("技術情報"); // 技術情報アナウンスも保護モード同等とする
        if (isShieldMode) {
            btnHtml = `
            <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">やめる</button>
                <button id="dssi-raw-btn" style="padding:6px 12px; background:#7f8c8d; color:white; border:none; border-radius:3px; cursor:pointer;">原文のまま送信</button>
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#3498db; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">🛡️ 保護して送信</button>
            </div>`;
        } else {
            // HTTP警告など
            btnHtml = `
            <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">やめる</button>
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">リスクを承知で送信</button>
            </div>`;
        }
    }

    // フッター構築
    let footerHtml = "";
    if (stats) {
        footerHtml = `
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.2); display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#bdc3c7;">
            <span>表示回数: ${stats.count}</span>
            <button id="dssi-mute-btn" style="background:none; border:none; color:#bdc3c7; cursor:pointer; text-decoration:underline;">今後表示しない</button>
        </div>`;
    }

    chip.innerHTML = `
        <span class="dssi-chip-title" style="color:${leftBorderColor}">${data.title}</span>
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
        
        let left = rect.left + scrollX - 300; 
        if (left < 10) left = 10;
        
        chip.style.top = `${top}px`;
        chip.style.left = `${left}px`;
    };

    const cleanupFns = [];

    if (isBlocker) {
        updatePosition();
        chip.classList.add("dssi-visible");
        
        const confirmBtn = chip.querySelector("#dssi-confirm-btn");
        const rawBtn = chip.querySelector("#dssi-raw-btn");
        const cancelBtn = chip.querySelector("#dssi-cancel-btn");
        
        if (confirmBtn) {
            confirmBtn.addEventListener("click", (e) => { 
                e.preventDefault(); chip.remove(); 
                if (blockerCallback) blockerCallback('protected'); 
            });
        }
        if (rawBtn) {
            rawBtn.addEventListener("click", (e) => { 
                e.preventDefault(); chip.remove(); 
                if (blockerCallback) blockerCallback('raw'); 
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener("click", (e) => { 
                e.preventDefault(); chip.remove(); 
                if (blockerCallback) blockerCallback('cancel'); 
            });
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
        let hideTimeout;

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
        field.dssiCleanup = () => { cleanupFns.forEach(fn => fn()); };
    }
}

// ==========================================
// 6. メイン処理ロジック (Processing)
// ==========================================
async function processField(field) {
    let chipData = getFieldConfig(field);
    if (!chipData) return;

    const protocol = window.location.protocol;
    if (protocol === 'http:') {
        chipData.riskLevel = RISK_CRITICAL;
    }

    if (!shouldMonitor(chipData.riskLevel)) {
        if (field.dssiChipElement) {
            field.dssiChipElement.remove();
            field.dssiChipElement = null;
        }
        field.style.border = "";
        field.classList.remove("dssi-observed-field");
        return;
    }

    if (field.dataset.dssiBound === "active") return;

    if (chipData.id) {
        const stats = await getChipStats(chipData.id);
        if (stats.muted) {
            field.dataset.dssiBound = "muted";
            field.style.border = `2px solid ${chipData.borderColor}`;
            field.classList.add("dssi-observed-field");
            return;
        } else {
            await updateChipStats(chipData.id, { increment: true });
            chipData.stats = { count: stats.count + 1 };
        }
    }

    field.dataset.dssiBound = "active";

    if (protocol === 'http:') {
        chipData.title = "⚠️ 技術情報: 非暗号化通信 (HTTP)";
        chipData.borderColor = "#e74c3c";
        chipData.fact = "【事実】 このページの通信経路は暗号化されていません。";
        chipData.purpose = "【目的】 古いシステムの互換性維持、または設定ミスです。";
        chipData.risk = "【リスク】 経路上の第三者が、入力内容を傍受可能です。";
        chipData.rec = "機密情報の入力は避け、VPN等の使用を検討してください。";
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

function attachChips() {
    const selector = (currentLevel >= 3) ? SELECTORS_ALL : SELECTORS_CORE;
    const fields = document.querySelectorAll(selector);
    fields.forEach(processField);
}

// --- 伏せ字ロジック ---
function applyShield(text, secrets = MY_SECRETS) {
    let shieldedText = text;
    let mapping = {};
    let count = 0;

    const patterns = {
        EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        PHONE: /\d{2,4}-\d{2,4}-\d{4}/g,
    };

    for (const [type, reg] of Object.entries(patterns)) {
        shieldedText = shieldedText.replace(reg, (match) => {
            count++;
            const placeholder = `[${type}_${count}]`;
            mapping[placeholder] = match;
            return placeholder;
        });
    }

    for (const [realName, placeholder] of Object.entries(secrets)) {
        if (!realName || realName.trim() === "") continue;
        const escaped = realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'g');
        
        const matches = shieldedText.match(re);
        if (matches) {
            count += matches.length;
            mapping[placeholder] = realName;
            shieldedText = shieldedText.replace(re, placeholder);
        }
    }
    return { shieldedText, mapping, count };
}

// --- AI回答復元ロジック ---
function reverseShield(node) {
    // 自分の入力欄（contenteditable）は絶対に復元対象にしない
    if (node.isContentEditable || node.tagName === 'TEXTAREA' || node.closest('[contenteditable="true"]')) return;
    let replaced = false;
    if (!node.innerHTML) return;
    let html = node.innerHTML;

    for (const [realName, placeholder] of Object.entries(MY_SECRETS)) {
        if (!realName || !placeholder) continue;
        
        if (html.includes(placeholder)) {
            const re = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            html = html.replace(re, `<span class="dssi-unmasked" 
                style="color: #3498db; border-bottom: 1px dotted #3498db; cursor: help;" 
                title="DSSIが原文 '${realName}' を復元しました">${realName}</span>`);
            replaced = true;
        }
    }

    if (replaced) {
        node.innerHTML = html;
        console.log("🛡️ DSSI: 伏せ字を復元しました。");
    }
}

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { 
                const targets = node.querySelectorAll('.message-content, .markdown, [role="presentation"], div[data-message-author-role="assistant"]');
                if (targets.length > 0) {
                    targets.forEach(reverseShield);
                } else if (node.classList.contains('markdown') || node.getAttribute('data-message-author-role') === 'assistant') {
                    reverseShield(node);
                }
            }
        });
    }
});
observer.observe(document.body, { childList: true, subtree: true });

// ==========================================
// 7. ガードアタッチメント (Guards)
// ==========================================

// --- Content Shield (受動的・透明な観測者版) ---
function attachContentShield() {
    const sendBtn = document.querySelector('button[aria-label*="送信"], button[aria-label*="Send"], button[data-testid*="send"]');
    
    if (!sendBtn || sendBtn.dataset.shieldBound === "true") return;
    sendBtn.dataset.shieldBound = "true";

    // 割り込まず、ただ「クリックされた」という事実から処理を開始する
    sendBtn.addEventListener('click', (e) => {
        // 既にDSSIが処理済み（2回目のクリック）なら何もしない
        if (sendBtn.dataset.shieldVerified === "true") {
            sendBtn.dataset.shieldVerified = "false";
            return;
        }

        const inputField = document.querySelector('div[contenteditable="true"], textarea');
        const rawText = inputField ? (inputField.innerText || inputField.value) : "";
        
        // 透明なアルゴリズム：ただ変換を実行し、結果を算出するだけ
        const { shieldedText, count } = applyShield(rawText);

        // 秘密の言葉が見つかった場合のみ、判定を仰ぐ「相談」を行う
        if (count > 0) {
            // 一時的に止めるが、これは主導権を奪うためではなく
            // 「この変換結果で良いですか？」という同意を得るため
            e.preventDefault();
            e.stopImmediatePropagation();

            const announce = DSSI_ANNOUNCER.select(); // 観測された通信事実

            renderChip(sendBtn, {
                title: announce.title,
                borderColor: "#e67e22", 
                fact: announce.fact,    // 通信の事実
                purpose: announce.purpose,
                risk: announce.risk,
                rec: announce.rec
            }, true, (result) => {
                // ユーザーの意思決定（コミット）に基づく分岐
                if (result === 'protected') {
                    if (inputField) {
                        inputField.innerText = shieldedText;
                        inputField.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    sendBtn.dataset.shieldVerified = "true";
                    sendBtn.click(); // ユーザーの合意を得て再実行
                } else if (result === 'raw') {
                    sendBtn.dataset.shieldVerified = "true";
                    sendBtn.click(); // 原文のまま送るという合意
                }
            });
        }
    }, true);
}

// --- Submit Guard (for HTTP Forms) ---
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
                fact: "【警告】 暗号化されていない経路(HTTP)で送信されようとしています。",
                purpose: "【DSSI介入】 意図しない情報漏洩を防ぐため、送信を一時停止しました。",
                risk: "【リスク】 送信内容は平文で流れるため、盗聴されるリスクが高いです。",
                rec: "本当に送信してよければ、「リスクを承知で送信」を押してください。"
            }, true, (result) => {
                if (result === 'protected' || result === 'raw') {
                    const inputVal = form.querySelector("input")?.value || "(入力なし)";
                    showSubmissionToast(`✅ 送信を受け付けました。`);
                    setTimeout(() => {
                        form.dataset.dssiAllowed = "true";
                        if (form.requestSubmit) form.requestSubmit(submitBtn);
                        else form.submit();
                    }, 1000);
                }
            });
        } else {
            if(confirm("【DSSI警告】\n暗号化されていない通信(HTTP)で送信しようとしています。本当に送信しますか？")) {
                form.dataset.dssiAllowed = "true";
                form.submit();
            }
        }
    }, true);
}

// --- Utils (Validation) ---
// 検証ロジック：画面に現れた「確定後のログ」だけを調べる
function validateDssiEffect(addedNode) {
    const text = addedNode.innerText;
    
    // 辞書に含まれる「生文」がそのまま出ていないか？
    const leaked = Object.keys(MY_SECRETS).some(realName => text.includes(realName));
    // 辞書の「伏せ字」が含まれているか？
    const masked = Object.values(MY_SECRETS).some(placeholder => text.includes(placeholder));

    if (leaked && !masked) {
        showStatusNotification("⚠️ 警告: 保護失敗。生文（SECRET_CODE...）が送信ログに確認されました。");
    } else if (masked) {
        showStatusNotification("✅ 実験成功: 送信ログに伏せ字を確認。");
    }
}

function showStatusNotification(msg) {
    const notify = document.createElement('div');
    notify.innerText = msg;
    notify.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: #333; color: #fff; padding: 10px 20px; border-radius: 5px;
        z-index: 10000; font-size: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(notify);
    setTimeout(() => notify.remove(), 3000);
}

// ==========================================
// 8. ライフサイクル管理
// ==========================================
function startGuard() {
    if (guardInterval) return;
    console.log("🛡️ DSSI Guard: Enabled.");
    attachChips();
    attachSubmitGuard();   
    attachContentShield(); 
    guardInterval = setInterval(() => {
        attachChips();
        attachContentShield();
    }, 2000);
}

function stopGuard() {
    if (!guardInterval && !document.querySelector('.dssi-observed-field')) return;
    console.log("🛡️ DSSI Guard: Disabled.");
    if (guardInterval) {
        clearInterval(guardInterval);
        guardInterval = null;
    }
    resetGuards();
}

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

// メインエントリポイント
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
        request.enabled ? startGuard() : stopGuard();
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