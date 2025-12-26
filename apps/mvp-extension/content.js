/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドの検知、技術的事実の提示、UI操作
 * ロジック: security-logic.js の DSSI_Security オブジェクトを利用
 * 機能: マルチターゲット検知、HTTP/HTTPS判定、バックグラウンド連携、ON/OFF制御、Submit Guard
 * 拡張: 粘性レベル制御 (Revised Logic)、枠線永続化、ホバー安定化、自動復活、リアルタイムリセット
 * 哲学: "Facts over Fear." / "We do not substitute your thought."
 * version: 1.2.0
 * 
 * 修正履歴:
 * - 1.0.0: 初版リリース
 * - 1.1.0: チップ描画ロジックの改善、ホバー安定化、自動復活機能追加
 * - 1.2.0: 内容保護シールド機能追加、Submit Guard機能強化、ストレージ操作の非同期化
 * 
 * 注意事項:
 * - content.js は security-logic.js に依存しています。両方を必ず同時に読み込んでください。
 * - content.js は UI 表示に関わる部分を担当し、セキュリティロジックは security-logic.js に集約されています。
 * - content.js の変更は UI/UX に影響します。セキュリティロジックの変更は security-logic.js で行ってください。
 * - content.js はブラウザのコンソールでデバッグログを出力します。不要な場合は削除してください。
 * - content.js は Chrome 拡張機能のメッセージング API を使用して、バックグラウンドスクリプトと通信します。
 * - content.js はストレージ API を使用して、ユーザー設定や統計情報を保存・取得します。
 * - content.js は DOM 操作を行います。パフォーマンスに注意して最適化してください。
 * - content.js はセキュリティに関わるコードを含みます。信頼できるソースからのみ配布してください。
 * - content.js は将来的に他のセキュリティ機能と連携する可能性があります。拡張性を考慮して設計してください。
 * - content.js はユーザーのプライバシーを尊重します。個人情報の収集や送信は行いません。
 * - content.js はオープンソースライセンスの下で配布されます。ライセンス条件を遵守してください。
 * - content.js は DSSI プロジェクトの一部です。プロジェクト全体の一貫性を保つよう努めてください。
 * - content.js は責任を持って使用してください。誤用による損害については責任を負いかねます。
 * - content.js は技術的な制約により、すべてのケースをカバーできない場合があります。ご了承ください。
 * - content.js は将来的に AI ベースの検出ロジックと連携する可能性があります。拡張性を考慮して設計してください。
 */

console.log("🛡️ DSSI Guard: Loaded (UI Mode).");

// 監視対象定義
const SELECTORS_ALL = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea';
const SELECTORS_CORE = 'input[type="password"], input[type="email"], input[name*="email"], input[id*="email"], input[name*="user"], input[id*="user"], input[name*="login"], input[id*="login"], input[name*="account"], input[id*="account"], input[name*="card"], input[name*="cc-"], input[id*="card"]';

let guardInterval = null;
let currentLevel = 2;

const RISK_CRITICAL = 0;
const RISK_HIGH     = 2;
const RISK_MID      = 3;
const RISK_LOW      = 3;

// --- ストレージ操作系 ---
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
// Helper: チップスの描画 (全機能維持)
// ---------------------------------------------
/**
 * v1.2.2: renderChip (介入ロック・座標計算修正版)
 * 指示: 以前の v1.2.1 から position 計算を fixed に最適化
 */
function renderChip(field, data, isBlocker = false, blockerCallback = null, stats = null) {
    const chipId = isBlocker ? 'dssi-blocker-chip' : `dssi-chip-${data.id}`;
    let chip = document.getElementById(chipId);

    if (chip) {
        // 既存のチップがある場合は位置だけ更新して return (再生成による消失を防ぐ)
        if (chip.dssiUpdatePosition) chip.dssiUpdatePosition();
        return;
    }

    chip = document.createElement("div");
    chip.id = chipId;
    chip.className = isBlocker ? "dssi-chip dssi-blocker-chip" : "dssi-chip";
    chip.style.borderLeft = `4px solid ${data.borderColor}`;
    
    // 位置更新関数の定義 (fixed なので getBoundingClientRect をそのまま利用)
    const updatePosition = () => {
        const rect = field.getBoundingClientRect();
        if (rect.top === 0 && rect.left === 0) return; // 非表示時は更新しない
        
        let top = rect.top - chip.offsetHeight - 12;
        if (top < 10) top = rect.bottom + 12;
        let left = rect.left;
        
        chip.style.top = `${top}px`;
        chip.style.left = `${left}px`;
    };
    chip.dssiUpdatePosition = updatePosition;

    // HTMLアセンブリ
    let btnHtml = "";
    if (isBlocker) {
        btnHtml = `
            <div style="margin-top:10px; display:flex; gap:8px; justify-content:flex-end;">
                <button id="dssi-cancel-btn" style="cursor:pointer;">やめる</button>
                <button id="dssi-raw-btn" style="cursor:pointer;">原文のまま送信</button>
                <button id="dssi-confirm-btn" style="cursor:pointer; border:2px solid gold; font-weight:bold;">🛡️ 保護して送信</button>
            </div>`;
    }

    chip.innerHTML = `
        <b style="color:${data.borderColor}">${data.title}</b>
        <div style="font-size:11px; margin-top:4px;">${data.fact}</div>
        <div style="font-size:11px; color:#ccc;">${data.rec}</div>
        ${btnHtml}
    `;

    document.body.appendChild(chip);
    updatePosition(); // 初回配置
    chip.classList.add("dssi-visible");

    if (isBlocker) {
        // ボタンイベント: 明示的なクリックまで remove() しない
        chip.querySelector("#dssi-confirm-btn").onclick = (e) => { e.preventDefault(); chip.remove(); blockerCallback('protected'); };
        chip.querySelector("#dssi-raw-btn").onclick = (e) => { e.preventDefault(); chip.remove(); blockerCallback('raw'); };
        chip.querySelector("#dssi-cancel-btn").onclick = (e) => { e.preventDefault(); chip.remove(); blockerCallback('cancel'); };
    } else {
        // 解説チップ: ホバー連動（時間制御なし）
        const hide = () => {
            if (field.dataset.dssiHover !== "true" && chip.dataset.dssiHover !== "true") {
                chip.remove();
            }
        };
        field.onmouseenter = () => { field.dataset.dssiHover = "true"; updatePosition(); };
        field.onmouseleave = () => { field.dataset.dssiHover = "false"; hide(); };
        chip.onmouseenter = () => { chip.dataset.dssiHover = "true"; };
        chip.onmouseleave = () => { chip.dataset.dssiHover = "false"; hide(); };
    }
}

/**
 * デバッグ専用：独立したポップアップを表示
 * 正規の renderChip とは完全に切り離し、body直下に配置する
 */
function renderDebugPopup(field, chipData) {
    if (!field || !field.isConnected) return;

    // 個別IDがない要素のために、一意のデバッグIDを生成（または既存のものを使用）
    if (!field.dataset.dssiDebugId) {
        field.dataset.dssiDebugId = "debug-" + Math.random().toString(36).slice(2, 9);
    }
    const debugId = `dssi-debug-${field.dataset.dssiDebugId}`;
    
    let debugLabel = document.getElementById(debugId);

    if (!debugLabel) {
        debugLabel = document.createElement('div');
        debugLabel.id = debugId;
        debugLabel.style = `
            position: fixed; z-index: 2147483647; background: rgba(255,0,255,0.9);
            color: white; padding: 2px 6px; font-family: monospace; font-size: 9px;
            border-radius: 2px; pointer-events: none; white-space: nowrap;
        `;
        document.body.appendChild(debugLabel);
    }

    // getBoundingClientRect() は画面上の位置を返すので、
    // fixed属性の要素にはそのまま（window.scrollを足さずに）適用する
    const rect = field.getBoundingClientRect();
    
    // フィールドが画面外にある時は隠す
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
        debugLabel.style.display = "none";
    } else {
        debugLabel.style.display = "block";
        debugLabel.style.top = `${rect.top - 20}px`; // フィールドの直上に配置
        debugLabel.style.left = `${rect.left}px`;
    }

    debugLabel.innerHTML = `[DSSI] ID:${chipData.id} | LV:${currentLevel}/${chipData.riskLevel}`;
}

// ---------------------------------------------
// Logic: フィールド個別設定の取得
// ---------------------------------------------
function getFieldConfig(field) {
    const type = (field.type || "").toLowerCase();
    const name = (field.name || field.id || "").toLowerCase();

    if (type === "password") {
        return {
            id: "guide_password", riskLevel: RISK_HIGH, title: "ℹ️ 技術情報: キー入力イベント",
            borderColor: "#e67e22", fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
            purpose: "【目的】 この技術は通常、利便性のために使われます。",
            risk: "【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。",
            rec: "パスワードマネージャーからの貼付けを推奨します。"
        };
    }
    if (name.includes("card") || name.includes("cc-") || name.includes("cvc")) {
        return {
            id: "guide_credit_card", riskLevel: RISK_HIGH, title: "💳 技術情報: 決済情報の入力",
            borderColor: "#e74c3c", fact: "【確認】 財務資産に直結する情報の入力欄です。",
            purpose: "【目的】 サービスや商品の購入決済に使用されます。",
            risk: "【リスク】 通信経路に不備がある場合、資産の不正利用に直結します。",
            rec: "アドレスバーに「鍵マーク(HTTPS)」があるか、必ず再確認してください。"
        };
    }
    if (type === "email" || name.includes("email") || name.includes("user") || name.includes("login")) {
        return {
            id: "guide_email", riskLevel: RISK_MID, title: "📧 技術情報: 連絡先情報の入力",
            borderColor: "#2ecc71", fact: "【確認】 個人を特定可能なIDの入力欄です。",
            purpose: "【目的】 認証、およびユーザーのトラッキングに使用されます。",
            risk: "【リスク】 フィッシングサイトの場合、入力した時点でリスト化される可能性があります。",
            rec: "このサイトのドメインが、意図した相手のものであるか確認してください。"
        };
    }
    return {
        id: "guide_general", riskLevel: RISK_LOW, title: "📝 技術情報: 一般入力フィールド",
        borderColor: "#5dade2", fact: "【確認】 汎用的な情報の入力欄です。",
        purpose: "【目的】 検索、コメント、その他のデータ送信に使用されます。",
        risk: "【リスク】 些細な情報でも、蓄積により個人の特定に利用される可能性があります。",
        rec: "不要な個人情報の入力を避けてください。"
    };
}

// ---------------------------------------------
// Logic: 各フィールドの処理 (メインループ)
// ---------------------------------------------
/**
 * DSSI Content Script: v1.2.4
 * ステータス: 統計復元・座標同期パッチ適用済
 */
async function processField(field) {
    if (!field.offsetParent) return;

    const chipData = getFieldConfig(field);
    const protocol = window.location.protocol;

    // --- [差分: v1.2.3より継承] デバッグポップを冒頭で必ず更新 ---
    renderDebugPopup(field, chipData);

    if (protocol === 'http:') chipData.riskLevel = 0;

    // --- [差分: v1.2.1より復元] 足切り時のクリーンアップ ---
    if (currentLevel < chipData.riskLevel) {
        field.style.outline = "4px dotted blue"; 
        if (field.dssiChipElement) { 
            field.dssiChipElement.remove(); 
            field.dssiChipElement = null; 
        }
        field.style.border = "";
        return;
    }

    // --- [差分: v1.2.3より追加] アクティブ時の座標同期 ---
    if (field.dataset.dssiBound === "active") {
        field.style.border = `2px solid ${chipData.borderColor}`;
        field.style.outline = "";
        if (field.dssiChipElement && field.dssiChipElement.dssiUpdatePosition) {
            field.dssiChipElement.dssiUpdatePosition();
        }
        return; 
    }

    // --- [差分: v1.2.1より復元] 統計・ミュートロジック ---
    if (chipData.id) {
        const stats = await getChipStats(chipData.id);
        if (stats.muted) {
            field.dataset.dssiBound = "muted";
            field.style.border = `2px solid ${chipData.borderColor}`;
            return;
        }
        await updateChipStats(chipData.id, { increment: true });
        chipData.stats = { count: stats.count + 1 };
    }

    // --- [差分: v1.2.2より修正] 描画フェーズ ---
    field.dataset.dssiBound = "active";
    field.style.outline = "";

    if (protocol === 'http:') {
        renderChip(field, {
            ...chipData,
            title: "⚠️ 技術情報: 非暗号化通信 (HTTP)",
            borderColor: "#e74c3c",
            fact: "【事実】 このページの通信経路は暗号化されていません。",
            rec: "機密情報の入力は避け、別経路での連絡を検討してください。"
        });
    } else {
        renderChip(field, chipData, false, null, chipData.stats);
        field.style.border = `2px solid ${chipData.borderColor}`;
    }
}

// ---------------------------------------------
// Logic: 内容保護シールド (送信監視 & おとり注入 & 検証)
// ---------------------------------------------
function attachContentShield() {
    const sendBtn = document.querySelector('button[aria-label="プロンプトを送信"], button[data-testid="send-button"], button[aria-label="送信"]');
    if (!sendBtn || sendBtn.dataset.shieldBound === "true") return;

    sendBtn.dataset.shieldBound = "true";
    sendBtn.addEventListener('click', async (e) => {
        if (sendBtn.dataset.shieldVerified === "true") {
            sendBtn.dataset.shieldVerified = "false";
            return;
        }

        const inputField = document.querySelector('div[contenteditable="true"], textarea');
        const rawText = inputField ? (inputField.innerText || inputField.value) : "";
        
        // ① 伏せ字処理の呼び出し
        const { shieldedText, count } = DSSI_Security.applyShield(rawText);

        if (count > 0 || rawText.length > 0) {
            e.preventDefault();
            e.stopPropagation();

            // ★ おとりの生成
            const decoy = DSSI_Security.createDecoy();

            renderChip(sendBtn, {
                title: "🛡️ DSSI 統合保護シールド",
                borderColor: "#3498db",
                fact: count > 0 ? `${count} 件の機密情報を検知しました。` : "通信の透明性を検証します。",
                purpose: "【主権保護】 伏せ字化とおとりデータによる通信経路の健全性チェックを行います。",
                risk: "未知のスクリプトによるデータ盗用（キーロガー等）を監視します。",
                rec: "「🛡️ 保護して送信」で、安全性を検証しながら送信します。"
            }, true, async (result) => {
                if (result === 'protected' || result === 'raw') {
                    const textToSend = (result === 'protected' ? shieldedText : rawText) + "\n\n" + decoy;

                    // フィールドに反映
                    if (inputField) {
                        if (inputField.tagName === 'DIV') {
                            inputField.innerText = textToSend;
                            inputField.dispatchEvent(new Event('input', { bubbles: true }));
                        } else {
                            inputField.value = textToSend;
                        }
                    }

                    // 送信実行
                    sendBtn.dataset.shieldVerified = "true";
                    sendBtn.click();

                    // ★ ② 答え合わせ（検証）の実行
                    // 送信完了後に通信がログに乗るまで少し待機 (2秒)
                    // ★ ② 答え合わせ（検証）の実行
                    setTimeout(() => {
                        console.log("🛡️ DSSI: 通信検証フェーズ開始...");
                        
                        const checkResult = DSSI_Security.validateTransmission(
                            result === 'protected' ? shieldedText : rawText, 
                            decoy
                        );

                        // デバッグ：検証結果をコンソールと画面に強制表示
                        console.log("🛡️ 検証結果:", checkResult);

                        // 既存の renderChip が失敗してもいいように、直接アラートを出すかログ用ラベルを更新
                        const debugLabel = document.querySelector('.dssi-debug-label');
                        if (debugLabel) {
                            debugLabel.innerHTML += `<br>検証結果: ${checkResult.status}`;
                            debugLabel.style.borderColor = "yellow"; // 検証が走った合図
                        }

                        renderChip(sendBtn, {
                            title: `🔍 通信検証結果: ${checkResult.status}`,
                            borderColor: statusColors[checkResult.status] || "#3498db",
                            fact: checkResult.message,
                            purpose: "DSSI Scannerによるリアルタイム通信解析の結果です。",
                            risk: "不明なステータスの場合、拡張機能以外のスクリプトが通信を制御している可能性があります。",
                            rec: "不審な結果が出た場合は、ブラウザをリロードして接続を切り替えてください。"
                        });
                    }, 2000);
                }
            });
        }
    }, true);
}

// ---------------------------------------------
// Logic: Submit Guard (標準フォーム送信への介入)
// ---------------------------------------------
function attachSubmitGuard() {
    document.addEventListener("submit", (e) => {
        const form = e.target;
        if (window.location.protocol === 'https:' || form.dataset.dssiAllowed === "true") return;

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
                if (result === 'protected' || result === 'raw') {
                    form.dataset.dssiAllowed = "true";
                    form.requestSubmit ? form.requestSubmit(submitBtn) : form.submit();
                }
            });
        }
    }, true);
}

// ---------------------------------------------
// Guard Control (開始・停止・リセット)
// ---------------------------------------------
function startGuard() {
    if (guardInterval) return;
    console.log("🛡️ DSSI Guard: Enabled.");

    // Geminiの入力欄（div[contenteditable]）を強制的に追加
    const getFields = () => {
        return document.querySelectorAll(
            'input:not([type="hidden"]), textarea, [contenteditable="true"]'
        );
    };

    const runProcess = () => {
        const fields = getFields();
        fields.forEach(processField); // ここでさきほどのマゼンタ判定が走る
        attachContentShield();
    };

    runProcess();
    attachSubmitGuard();
    
    guardInterval = setInterval(runProcess, 2000);
}

function stopGuard() {
    if (guardInterval) { clearInterval(guardInterval); guardInterval = null; }
    hideAllChips();
    document.querySelectorAll('.dssi-observed-field').forEach(field => {
        field.style.border = "";
        delete field.dataset.dssiBound;
    });
}

function hideAllChips() {
    document.querySelectorAll('.dssi-chip').forEach(c => c.remove());
}

function resetGuards() {
    stopGuard();
    setTimeout(startGuard, 100);
}

// ---------------------------------------------
// Entry Point & Message Listeners
// ---------------------------------------------
chrome.storage.local.get(['dssiEnabled', 'dssiLevel'], (result) => {
    currentLevel = result.dssiLevel || 2;
    if (result.dssiEnabled !== false) startGuard();
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "TOGGLE_GUARD") request.enabled ? startGuard() : stopGuard();
    if (request.action === "RESET_GUARD") resetGuards();
    if (request.action === "UPDATE_SETTINGS") {
        if (request.level !== undefined) { currentLevel = request.level; resetGuards(); }
        if (request.enabled !== undefined) request.enabled ? startGuard() : stopGuard();
    }
});