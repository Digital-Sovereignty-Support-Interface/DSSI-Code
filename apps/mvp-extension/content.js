/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドの検知、技術的事実（チップス）の提示、危険な送信のブロック。
 * 機能: マルチターゲット検知、HTTP/HTTPS判定、バックグラウンド連携、ON/OFF制御、Submit Guard。
 * 拡張: 粘性レベル制御 (Revised Logic)、枠線永続化、ホバー安定化、自動復活、リアルタイムリセット。
 * 哲学: "Facts over Fear." / "We do not substitute your thought."
 */

// 🛡️ DSSI 専用スタイルをブラウザに強制注入
(function() {
    const style = document.createElement('style');
    style.textContent = `
        /* 復元された文字のスタイル */
        .dssi-unmasked {
            color: #00d1b2 !important; /* 鮮やかなターコイズブルー */
            border-bottom: 2px dashed #00d1b2 !important;
            background-color: rgba(0, 209, 178, 0.1) !important;
            font-weight: bold !important;
            padding: 0 2px !important;
            border-radius: 3px !important;
            cursor: help !important;
        }
        /* ポップアップが右に隠れないための補正 */
        #dssi-chip {
            z-index: 9999 !important;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
        }
    `;
    document.head.appendChild(style);
    console.log("🛡️ DSSI Styles Injected.");
})();
console.log("🛡️ DSSI Guard: Loaded.");
/**
 * DSSI 通信解剖モジュール (Traffic Analyzer)
 * 目的: Geminiが[FOOD002]という伏せ字をどう扱っているか、裏側の通信を可視化する。
 */
const DSSI_PROBE = {
    flags: {
        fetchUsed: false,
        xhrUsed: false,
        binaryDetected: false,
        streamingDetected: false
    }
};

// 1. Fetch(フェッチ)の乗っ取り
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    DSSI_PROBE.flags.fetchUsed = true;
    const url = args[0].toString();
    
    // Geminiの通信っぽいものだけを狙い撃ち
    if (url.includes("google.internal") || url.includes("ChatService")) {
        console.log("📡 [DSSI-Fetch]:", url);
        
        // ボディがバイナリかチェック
        if (args[1]?.body instanceof Uint8Array || args[1]?.body instanceof ArrayBuffer) {
            DSSI_PROBE.flags.binaryDetected = true;
            console.warn("⚠️ [DSSI-Alert]: バイナリ(Protobuf可能)な通信を検知！");
        }
    }
    return originalFetch(...args);
};

// 2. XMLHttpRequest(XML通信)の乗っ取り
const originalXHR = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function(method, url) {
    DSSI_PROBE.flags.xhrUsed = true;
    this._url = url;
    console.log(`📨 [DSSI-XHR]: ${method} ${url}`);
    
    const originalSend = this.send;
    this.send = function(data) {
        if (data instanceof ArrayBuffer || data instanceof Blob) {
            DSSI_PROBE.flags.binaryDetected = true;
            console.warn("⚠️ [DSSI-Alert]: XHR経由のバイナリ送信を検知！");
        }
        return originalSend.apply(this, arguments);
    };
    
    return originalXHR.apply(this, arguments);
};

// 3. 通信状況をチップに反映させるための関数
function getTrafficStatus() {
    let status = "【通信解析】: ";
    if (DSSI_PROBE.flags.binaryDetected) status += "👾バイナリ ";
    if (DSSI_PROBE.flags.fetchUsed) status += "🌐Fetch ";
    if (DSSI_PROBE.flags.xhrUsed) status += "✉️XHR ";
    return status || "【通信解析】: 待機中...";
}

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

// --- [MODIFIED] renderChip: ボタン生成ロジックの刷新 ---
// 変更点: isBlocker の時、タイトルに「保護」が含まれるなら3ボタン化する

    let btnHtml = "";
    let footerHtml = "";

    if (isBlocker) {
        // ' VBAでいうところの「内容による分岐」
        const isShieldMode = data.title.includes("保護");

        if (isShieldMode) {
            // ' ケースA: 内容保護シールド用の3ボタン構成
            btnHtml = `
            <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">やめる</button>
                <button id="dssi-raw-btn" style="padding:6px 12px; background:#7f8c8d; color:white; border:none; border-radius:3px; cursor:pointer;">原文のまま送信</button>
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#3498db; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">🛡️ 保護して送信</button>
            </div>`;
        } else {
            // ' ケースB: 従来のHTTP通信警告用の2ボタン構成
            btnHtml = `
            <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">やめる</button>
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">リスクを承知で送信</button>
            </div>`;
        }
    }

    // ' footerHtml は削除せず、統計情報（stats）があれば常に組み立てる（独立した論理）
    if (typeof getFieldStats === "function") {
        const stats = getFieldStats(field);
        if (stats) {
            footerHtml = `
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.2); display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#bdc3c7;">
                <span>表示回数: ${stats.count}</span>
                <button id="dssi-mute-btn" style="...">今後表示しない</button>
            </div>`;
        }else {
        // 関数がない場合は、空のままエラーを出さずに進む
        footerHtml = "";
        }
    }

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
        
        // ★ 修正：左端を少し左にずらす (例: -300px) か、中央寄せを検討
        let left = rect.left + scrollX - 300; 
        if (left < 10) left = 10; // 画面左端に突き抜けないようガード
        
        chip.style.top = `${top}px`;
        chip.style.left = `${left}px`;
    };

    const cleanupFns = [];

    if (isBlocker) {
        updatePosition();
        chip.classList.add("dssi-visible");
        
        const confirmBtn = chip.querySelector("#dssi-confirm-btn"); // 「保護して送信」または「承知で送信」
        const rawBtn = chip.querySelector("#dssi-raw-btn");         // 「原文のまま送信」
        const cancelBtn = chip.querySelector("#dssi-cancel-btn");   // 「やめる」
        
        // 1. 承認・保護ボタンの処理
        if (confirmBtn) {
            confirmBtn.addEventListener("click", (e) => { 
                e.preventDefault(); 
                chip.remove(); 
                if (blockerCallback) blockerCallback('protected'); // 'true' の代わりに 'protected'
            });
        }
        // 2. 原文送信ボタンの処理（新規）
        if (rawBtn) {
            rawBtn.addEventListener("click", (e) => { 
                e.preventDefault(); 
                chip.remove(); 
                if (blockerCallback) blockerCallback('raw');       // 'raw' を返す
            });
        }
        // 3. キャンセルボタンの処理
        if (cancelBtn) {
            cancelBtn.addEventListener("click", (e) => { 
                e.preventDefault(); 
                chip.remove(); 
                if (blockerCallback) blockerCallback('cancel');    // 'false' の代わりに 'cancel'
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
    "クリエイター": "[TEST_MASK]",
    "人工呼吸": "[FOOF001]",
    "双子": "[FOOD002]",
    "清水克敏": "[PERSON_A]",
    "清水": "[PERSON_B]",
    "清水 克敏": "[PERSON_C]",
    "清水　克敏": "[PERSON_D]",
    "O.A.E.株式会社": "[COMPANY_RED]"
};

/**
 * 精緻化された applyShield：固有名詞などの伏せ字化
 * @param {string} text - 原文
 * @param {object} secrets - ユーザー定義辞書（デフォルトはMY_SECRETS）
 * @returns {object} - { shieldedText: 加工後, mapping: 復元用辞書, count: 件数 }
 */
function applyShield(text, secrets = MY_SECRETS) {
    let shieldedText = text;
    let mapping = {}; // ★マスターの mapping を復元
    let count = 0;

    // 1. 自動検知（正規表現）: メール、電話番号、URLなど
    const patterns = {
        EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        PHONE: /\d{2,4}-\d{2,4}-\d{4}/g,
    };

    for (const [type, reg] of Object.entries(patterns)) {
        shieldedText = shieldedText.replace(reg, (match) => {
            count++;
            const placeholder = `[${type}_${count}]`;
            mapping[placeholder] = match; // ★何を置換したか記録
            return placeholder;
        });
    }

    // 2. ユーザー定義辞書（secrets）による置換
    for (const [realName, placeholder] of Object.entries(secrets)) {
    if (!realName || realName.trim() === "") continue;
        
        const escaped = realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'g');
        
        // 置換前に一致箇所があるか確認し、mappingに記録
        const matches = shieldedText.match(re);
        if (matches) {
            count += matches.length;
            mapping[placeholder] = realName; // ★辞書分も記録
            shieldedText = shieldedText.replace(re, placeholder);
        }
    }

    // マスターの当初の戻り値形式 { shieldedText, mapping, count } を完全に守ります
    return { shieldedText, mapping, count };
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

function attachContentShield() {
    // 1. セレクターを「部分一致 (*=)」に広げて、Geminiの微細な変化を許容する
    const sendBtn = document.querySelector('button[aria-label*="送信"], button[aria-label*="Send"], button[data-testid*="send"]');
    
    if (!sendBtn) return;
    if (sendBtn.dataset.shieldBound === "true") return;
    
    sendBtn.dataset.shieldBound = "true";
    
    // 2. 「click」を「true (キャプチャフェーズ)」で奪い取る
    // これにより、Google側のスクリプトが動く前にDSSIが割り込みます
    sendBtn.addEventListener('click', (e) => {
        if (sendBtn.dataset.shieldVerified === "true") {
            sendBtn.dataset.shieldVerified = "false"; 
            return;
        }

        const inputField = document.querySelector('div[contenteditable="true"], textarea');
        const rawText = inputField ? (inputField.innerText || inputField.value) : "";
        
        const { shieldedText, count } = applyShield(rawText);

        // 判定：伏せ字があるなら、問答無用で止めてチップを出す
        if (count > 0) {
            e.preventDefault();
            e.stopImmediatePropagation(); // 他のスクリプト（Google）への通知を完全に遮断
            e.stopPropagation();

            renderChip(sendBtn, {
                title: "🛡️ DSSI 内容保護シールド",
                borderColor: "#3498db",
                fact: `${count} 件の情報を検知しました。`,
                purpose: "【DSSI】 外部への実名送信を制限しています。",
                risk: "実名を送るとGoogleの学習データに含まれるリスクがあります。",
                rec: "保護して送信するか、原文で送るかを選択してください。"
            }, true, (result) => {
                if (result === 'protected') {
                    if (inputField) {
                        inputField.innerText = shieldedText;
                        inputField.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    sendBtn.dataset.shieldVerified = "true";
                    sendBtn.click();
                } else if (result === 'raw') {
                    sendBtn.dataset.shieldVerified = "true";
                    sendBtn.click();
                }
            });
        }
    }, true); // ★ここを true にするのが、DSSIが先行する鍵です
}

// 判定：実際に何が飛んだかを画面上で確認
function validateDssiEffect(expected) {
    setTimeout(() => {
        const userBubbles = document.querySelectorAll('[data-message-author-role="user"]');
        if (userBubbles.length > 0) {
            const lastMsg = userBubbles[userBubbles.length - 1].innerText;
            if (lastMsg.includes('[FOOF') || lastMsg.includes('[TEST_MASK]')) {
                showValidationResult("✅ DSSI: 変換して送信されました。", "success");
            } else {
                showValidationResult("⚠️ 警告: 変換前の生文が送信された可能性があります。", "error");
            }
        }
    }, 1500);

// ユーザーに現状を伝えるための通知関数
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

    // Enterキーとクリック、両方のルートをキャプチャモードで監視
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) handleTransmission(e);
    }, true);

    sendBtn.addEventListener('mousedown', handleTransmission, true);
}

/**
 * [Integrated] attachSubmitGuard
 * 役割: HTTP通信時の送信をブロックする（既存機能の維持）
 */
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
            }, true, (result) => {
                // 返ってきたのが 'protected' または 'raw' なら送信許可
                if (result === 'protected' || result === 'raw') {
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
            // 代替手段としての標準ダイアログ（既存ロジック）
            if(confirm("【DSSI警告】\n暗号化されていない通信(HTTP)で送信しようとしています。本当に送信しますか？")) {
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

/**
 * AIの回答内の伏せ字を元の名前に復元する
 */
function reverseShield(node) {
    let replaced = false;
    let text = node.innerHTML;

    for (const [realName, placeholder] of Object.entries(MY_SECRETS)) {
        if (!realName || !text.includes(placeholder)) continue;

        // 見た目だけ復元（DSSIが戻したことがわかるよう、薄い青色などの装飾を推奨）
        const re = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        text = text.replace(re, `<span class="dssi-unmasked" style="color: #3498db; border-bottom: 1px dotted;" title="DSSIが原文を復元しました">${realName}</span>`);
        replaced = true;
    }

    if (replaced) node.innerHTML = text;
}

/**
 * 【受信保護】AIの回答内の伏せ字を元の名前に復元する
 */
function reverseShield(node) {
    let replaced = false;
    // nodeがテキストを含まない場合はスキップ
    if (!node.innerHTML) return;
    
    let html = node.innerHTML;

    for (const [realName, placeholder] of Object.entries(MY_SECRETS)) {
        if (!realName || !placeholder) continue;
        
        // 伏せ字が含まれているかチェック
        if (html.includes(placeholder)) {
            // 正規表現で全置換。DSSIが戻したことがわかるようスタイルを適用
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

/**
 * Geminiの回答エリアを監視し、新しいメッセージが出たら復元を実行
 */
const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // 要素ノードのみ対象
                // Geminiの回答テキストが入る可能性のある要素をすべてスキャン
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

// 監視の開始（body全体を監視して、回答が追加されるのを待ち構える）
observer.observe(document.body, { childList: true, subtree: true });

// /**
//  * 🛡️ DSSI 最終兵器：パケット・インターセプター
//  * ブラウザから送信される直前のデータを捕まえて、強制的に伏せ字にする
//  */
// const originalFetch = window.fetch;
// window.fetch = async (...args) => {
//     let [resource, config] = args;

//     // 通信データ（body）が存在し、文字列である場合のみ処理
//     if (config && config.body && typeof config.body === 'string') {
//         try {
//             let shieldedBody = config.body;
//             let isModified = false;

//             // 辞書（MY_SECRETS）をループして、パケット内を全スキャン
//             for (const [realName, mask] of Object.entries(MY_SECRETS)) {
//                 if (!realName) continue;
                
//                 // パケット内に実名が含まれていたら、容赦なく伏せ字に置換
//                 if (shieldedBody.includes(realName)) {
//                     const re = new RegExp(realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
//                     shieldedBody = shieldedBody.replace(re, mask);
//                     isModified = true;
//                 }
//             }

//             if (isModified) {
//                 console.log("🛡️ DSSI Packet Guard: 送信パケットを伏せ字に書き換えました。");
//                 config.body = shieldedBody;
//             }
//         } catch (err) {
//             console.error("DSSI Packet Guard Error:", err);
//         }
//     }
//     return originalFetch(resource, config);
// };

// /**
//  * 🛡️ DSSI 最終兵器 第2弾：XHRインターセプター
//  * XMLHttpRequest (XHR) による送信も強制的に伏せ字化する
//  */
// const originalXHRSend = window.XMLHttpRequest.prototype.send;
// window.XMLHttpRequest.prototype.send = function(body) {
//     if (typeof body === 'string') {
//         let shieldedBody = body;
//         let isModified = false;

//         for (const [realName, mask] of Object.entries(MY_SECRETS)) {
//             if (realName && shieldedBody.includes(realName)) {
//                 const re = new RegExp(realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
//                 shieldedBody = shieldedBody.replace(re, mask);
//                 isModified = true;
//             }
//         }

//         if (isModified) {
//             console.log("🛡️ DSSI XHR Guard: 送信データを保護しました。");
//             arguments[0] = shieldedBody; // 送信データを書き換える
//         }
//     }
//     return originalXHRSend.apply(this, arguments);
// };