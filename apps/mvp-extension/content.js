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
function renderChip(field, data, isBlocker = false, blockerCallback = null, stats = null) {
    if (field.dssiChipElement) { field.dssiChipElement.remove(); field.dssiChipElement = null; }
    if (isBlocker) {
        const existingBlocker = document.querySelector('.dssi-blocker-chip');
        if (existingBlocker) existingBlocker.remove();
    }

    if (data.borderColor === "#e74c3c" && !data.id) { field.classList.add("dssi-danger-field"); }
    if (!isBlocker) {
        field.style.border = `2px solid ${data.borderColor}`;
        field.classList.add("dssi-observed-field");
    }

    if (!isBlocker && (currentLevel < data.riskLevel)) {
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

    let btnHtml = "";
    if (isBlocker) {
        if (data.title.includes("保護")) {
            btnHtml = `
            <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">やめる</button>
                <button id="dssi-raw-btn" style="padding:6px 12px; background:#7f8c8d; color:white; border:none; border-radius:3px; cursor:pointer;">原文のまま送信</button>
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#3498db; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">🛡️ 保護して送信</button>
            </div>`;
        } else {
            btnHtml = `
            <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">やめる</button>
                <button id="dssi-confirm-btn" style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">リスクを承知で送信</button>
            </div>`;
        }
    }

    chip.innerHTML = `
        <span class="dssi-chip-title" style="color:${leftBorderColor}">${data.title}</span>
        ${data.fact}<br>${data.purpose}<br>${data.risk}<br>
        <strong>推奨:</strong> ${data.rec}
        ${btnHtml}
    `;
    document.body.appendChild(chip);

    // 位置更新ロジック (省略せず維持)
    const updatePosition = () => {
        const rect = field.getBoundingClientRect();
        const scrollY = window.scrollY;
        const scrollX = window.scrollX;
        let top = rect.top + scrollY - chip.offsetHeight - 10;
        if (top < scrollY) top = rect.bottom + scrollY + 10;
        let left = rect.left + scrollX - 100; 
        if (left < 10) left = 10;
        chip.style.top = `${top}px`;
        chip.style.left = `${left}px`;
    };

    if (isBlocker) {
        updatePosition();
        chip.classList.add("dssi-visible");
        chip.querySelector("#dssi-confirm-btn")?.addEventListener("click", (e) => { e.preventDefault(); chip.remove(); blockerCallback('protected'); });
        chip.querySelector("#dssi-raw-btn")?.addEventListener("click", (e) => { e.preventDefault(); chip.remove(); blockerCallback('raw'); });
        chip.querySelector("#dssi-cancel-btn")?.addEventListener("click", (e) => { e.preventDefault(); chip.remove(); blockerCallback('cancel'); });
    } else {
        field.addEventListener("mouseenter", () => { hideAllChips(); chip.style.display='block'; updatePosition(); chip.classList.add("dssi-visible"); });
        field.addEventListener("mouseleave", () => { chip.classList.remove("dssi-visible"); setTimeout(()=>chip.style.display='none', 300); });
        field.dssiChipElement = chip;
    }
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
// Logic: 各フィールドの処理 (デバッグ・スキップ検知版)
// ---------------------------------------------
async function processField(field) {
    // 【検証1】 関数が呼び出されたか？（枠なしならここ以前で止まっている）
    // field.style.outline = "2px solid yellow"; 

    // ゾーン0: 表示状態チェック
    if (!field.offsetParent) return;

    let chipData = getFieldConfig(field);
    const protocol = window.location.protocol;
    
    // HTTP環境ならリスクを最上位へ
    if (protocol === 'http:') {
        chipData.riskLevel = RISK_CRITICAL;
    }

    // --- ゾーン1: レベルによる足切り判定 ---
    if (currentLevel < chipData.riskLevel) {
        // 【検証2】 レベル不足で弾かれた場合（青い点線が出る）
        field.style.outline = "4px dotted blue"; 
        
        if (field.dssiChipElement) { 
            field.dssiChipElement.remove(); 
            field.dssiChipElement = null; 
        }
        field.style.border = "";
        return;
    }

    // すでにアクティブならスキップ
    if (field.dataset.dssiBound === "active") return;

    // 統計情報の取得（ミュート判定）
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

    // --- ゾーン2: 描画直前 ---
    // 【検証3】 ロジックを完走した証拠（マゼンタの点線が出る）
    field.style.outline = "4px dotted magenta"; 

    field.dataset.dssiBound = "active";
    
    // --- ゾーン3: 実際の描画処理 (renderChipの呼び出し) ---
    if (protocol === 'http:') {
        chipData.title = "⚠️ 技術情報: 非暗号化通信 (HTTP)";
        chipData.borderColor = "#e74c3c";
        chipData.fact = "【事実】 このページの通信経路は暗号化されていません。";
        chipData.rec = "機密情報の入力は避け、別経路での連絡を検討してください。";
        renderChip(field, chipData);
    } else {
        // HTTPS環境でも、マゼンタが出る状態なら強制的に「監視中」の見た目を与える
        // chipData.borderColor を使って、チップは出さずとも枠線だけは維持させる
        renderChip(field, chipData, false, null, chipData.stats);
        
        // デバッグ用：マゼンタを消して、本来の色にする
        field.style.outline = ""; 
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
                    setTimeout(() => {
                        const checkResult = DSSI_Security.validateTransmission(
                            result === 'protected' ? shieldedText : rawText, 
                            decoy
                        );

                        // 検証結果をチップで提示
                        const statusColors = {
                            "NORMAL": "#2ecc71",
                            "SUSPICIOUS_FILTERING": "#f1c40f",
                            "CRITICAL_UNKNOWN": "#e74c3c",
                            "INDETERMINATE": "#95a5a6"
                        };

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