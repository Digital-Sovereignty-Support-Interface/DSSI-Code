/**
 * DSSI Content Script (Observer & Guide)
 * 責務: 入力フィールドの検知、技術的事実（チップス）の提示、危険な送信のブロック。
 * 機能: マルチターゲット検知、HTTP/HTTPS判定、バックグラウンド連携、ON/OFF制御、Submit Guard。
 * 拡張: 枠線の永続化（ミュート時も表示）、メール検知強化。
 * 哲学: "Facts over Fear."
 */

console.log("🛡️ DSSI Guard: Loaded.");

// 監視対象の拡大 (username, login, account などを追加)
const TARGET_SELECTORS = `
    input[type="password"],
    input[type="email"],
    input[name*="email"], input[id*="email"],
    input[name*="user"], input[id*="user"],
    input[name*="login"], input[id*="login"],
    input[name*="account"], input[id*="account"],
    input[name*="card"], input[name*="cc-"], input[id*="card"]
`;

let guardInterval = null;

// ---------------------------------------------
// Logic: ストレージ操作
// ---------------------------------------------
const STORAGE_KEY_STATS = 'dssi_stats';

async function getChipStats(chipId) {
    return new Promise((resolve) => {
        if (!chrome.runtime?.id) return;
        chrome.storage.local.get([STORAGE_KEY_STATS], (result) => {
            const stats = result[STORAGE_KEY_STATS] || {};
            resolve(stats[chipId] || { count: 0, muted: false, lastMutedAt: null });
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
// Logic: フィールド定義
// ---------------------------------------------
function getFieldConfig(field) {
    const type = (field.type || "").toLowerCase();
    const name = (field.name || field.id || "").toLowerCase();

    // A. パスワード
    if (type === "password") {
        return {
            id: "guide_password",
            title: "ℹ️ 技術情報: キー入力イベント",
            borderColor: "#e67e22", // オレンジ
            fact: "【注意喚起】 このフィールドへの入力操作は、スクリプトにより取得可能です。",
            purpose: "【目的】 この技術は通常、利便性（入力補助など）のために使われます。",
            risk: "【リスク】 技術が悪用されると入力内容を盗み見る（キーロガー）ことが可能です。",
            rec: "キーロガー対策のため、手入力ではなくパスワードマネージャーからの貼付けを推奨します。"
        };
    }
    
    // B. クレジットカード
    if (name.includes("card") || name.includes("cc-") || name.includes("cvc")) {
        return {
            id: "guide_credit_card",
            title: "💳 技術情報: 決済情報の入力",
            borderColor: "#e74c3c", // 赤
            fact: "【確認】 財務資産に直結する情報の入力欄です。",
            purpose: "【目的】 サービスや商品の購入決済に使用されます。",
            risk: "【リスク】 通信経路や保存方法に不備がある場合、資産の不正利用に直結します。",
            rec: "ブラウザのアドレスバーに「鍵マーク(HTTPS)」があるか、必ず再確認してください。"
        };
    }

    // C. メールアドレス/ID (拡張検知)
    if (type === "email" || name.includes("email") || name.includes("mail") || name.includes("user") || name.includes("login")) {
        return {
            id: "guide_email",
            title: "📧 技術情報: 連絡先情報の入力",
            borderColor: "#2ecc71", // 緑
            fact: "【確認】 個人を特定、追跡可能なID（メールアドレス）の入力欄です。",
            purpose: "【目的】 連絡、認証、およびユーザーのトラッキング（追跡）に使用されます。",
            risk: "【リスク】 フィッシングサイトの場合、入力した時点でリスト化される可能性があります。",
            rec: "このサイトのドメイン（URL）が、意図した相手のものであるか確認してください。"
        };
    }

    return null;
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
// Helper: 全チップスの消去
// ---------------------------------------------
function hideAllChips() {
    document.querySelectorAll('.dssi-chip').forEach(chip => {
        if (!chip.classList.contains('dssi-blocker-chip')) {
            chip.classList.remove("dssi-visible");
        }
    });
}

// ---------------------------------------------
// Helper: チップスの描画
// ---------------------------------------------
function renderChip(field, data, isBlocker = false, blockerCallback = null, stats = null) {
    if (field.dssiChipElement) field.dssiChipElement.remove();
    if (isBlocker) {
        const existingBlocker = document.querySelector('.dssi-blocker-chip');
        if (existingBlocker) existingBlocker.remove();
    }

    // 1. 枠線の適用 (ここは常に行う)
    // 危険度が高い場合(HTTP等)は点滅スタイルを追加
    if (data.borderColor === "#e74c3c" && !data.id) { 
        field.classList.add("dssi-danger-field");
    }
    if (!isBlocker) {
        field.style.border = `2px solid ${data.borderColor}`;
        field.classList.add("dssi-observed-field");
    }

    // ★重要: ミュート済みならチップス生成をスキップ (枠線だけ残して終了)
    if (stats && stats.muted) {
        return;
    }

    // 2. チップスの生成 (ミュートされていない場合のみ)
    const chip = document.createElement("div");
    chip.className = isBlocker ? "dssi-chip dssi-blocker-chip" : "dssi-chip";
    const leftBorderColor = (data.borderColor === "#e74c3c" || data.borderColor === "#c0392b") ? data.borderColor : data.borderColor;
    chip.style.borderLeft = `4px solid ${leftBorderColor}`;
    
    if (isBlocker || stats) {
        chip.style.pointerEvents = "auto";
    }

    let btnHtml = "";
    let footerHtml = "";

    if (isBlocker) {
        btnHtml = `
        <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:10px;">
            <button id="dssi-cancel-btn" style="padding:6px 12px; background:#95a5a6; color:white; border:none; border-radius:3px; cursor:pointer;">送信をやめる</button>
            <button id="dssi-confirm-btn" style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">リスクを承知で送信</button>
        </div>`;
    } else if (stats) {
        footerHtml = `
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.2); display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#bdc3c7;">
            <span>表示回数: ${stats.count}</span>
            <button id="dssi-mute-btn" style="background:transparent; border:1px solid #7f8c8d; color:#bdc3c7; border-radius:3px; cursor:pointer; padding:2px 5px; font-size:10px;">今後表示しない</button>
        </div>
        `;
    }

    chip.innerHTML = `
        <span class="dssi-chip-title" style="color:${leftBorderColor === '#e67e22' ? '#f1c40f' : (leftBorderColor === '#3498db' ? '#3498db' : (leftBorderColor === '#2ecc71' ? '#2ecc71' : '#e74c3c'))}">${data.title}</span>
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
        chip.style.top = `${rect.top + scrollY - chip.offsetHeight - 10}px`;
        chip.style.left = `${rect.left + scrollX}px`;
    };

    if (isBlocker) {
        updatePosition();
        chip.classList.add("dssi-visible");
        
        const confirmBtn = chip.querySelector("#dssi-confirm-btn");
        const cancelBtn = chip.querySelector("#dssi-cancel-btn");
        
        if (confirmBtn) confirmBtn.addEventListener("click", (e) => {
            e.preventDefault(); chip.remove();
            if (blockerCallback) blockerCallback(true);
        });
        if (cancelBtn) cancelBtn.addEventListener("click", (e) => {
            e.preventDefault(); chip.remove();
            if (blockerCallback) blockerCallback(false);
        });
        
        const outsideClickListener = (e) => {
            if (!chip.contains(e.target) && e.target !== field) {
                chip.remove();
                document.removeEventListener("click", outsideClickListener);
            }
        };
        setTimeout(() => document.addEventListener("click", outsideClickListener), 100);

    } else {
        const showChip = () => {
            hideAllChips();
            updatePosition();
            chip.classList.add("dssi-visible");
        };
        const hideChip = () => {
            chip.classList.remove("dssi-visible");
        };
        
        field.addEventListener("focus", showChip);
        field.addEventListener("mouseenter", showChip);
        
        const muteBtn = chip.querySelector("#dssi-mute-btn");
        if (muteBtn) {
            muteBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                updateChipStats(data.id, { mute: true });
                chip.remove();
                // ★重要変更: ミュート時は枠線（style.border）は消さない！
                console.log(`DSSI: Muted chip for ${data.id}, but border remains.`);
            });
        }

        let hoverTimeout;
        const delayedHide = () => {
            hoverTimeout = setTimeout(hideChip, 200);
        };
        const cancelHide = () => {
            clearTimeout(hoverTimeout);
        };

        field.addEventListener("blur", delayedHide);
        field.addEventListener("mouseleave", delayedHide);
        chip.addEventListener("mouseenter", cancelHide);
        chip.addEventListener("mouseleave", delayedHide);
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

    // Stats取得とミュート状態の判定
    if (chipData.id) {
        const stats = await getChipStats(chipData.id);
        
        // ★重要変更: ミュートされていても「枠線表示」のためにrenderChipは呼ぶ。
        // renderChip側で「mutedならチップスは作らない」という制御を行う。
        // ただし、カウントアップはミュート時は停止する（静かにしておく）のがマナーか？
        // → ここでは「表示回数＝チップスを見た回数」として、ミュート時はカウントしない。
        
        chipData.stats = { count: stats.count, muted: stats.muted };
        
        if (!stats.muted) {
             await updateChipStats(chipData.id, { increment: true });
             chipData.stats.count++;
        }
    }

    field.dataset.dssiBound = "true";
    const protocol = window.location.protocol;

    if (protocol === 'http:') {
        // HTTP警告（最優先）
        chipData.title = "⚠️ 技術情報: 非暗号化通信 (HTTP)";
        chipData.borderColor = "#e74c3c"; // 赤
        chipData.fact = "【事実】 このページの通信経路は暗号化されていません。";
        chipData.purpose = "【目的】 古いシステムの互換性維持、または設定ミスによりこの状態になっています。";
        chipData.risk = "【リスク】 経路上の第三者が、入力内容を傍受可能です。";
        chipData.rec = "機密情報の入力は避け、VPNの使用や別経路での連絡を検討してください。";
        chipData.stats = null; // HTTP警告はミュート不可
        
        renderChip(field, chipData);
    
    } else if (protocol === 'https:') {
        try {
            chrome.runtime.sendMessage({ type: "CHECK_CERTIFICATE", url: window.location.href }, (response) => {
                if (chrome.runtime.lastError) return;
                
                if (response && response.status === "expired") {
                    chipData.title = "🚫 技術情報: 証明書期限切れ";
                    chipData.borderColor = "#c0392b"; // 濃い赤
                    chipData.fact = `【事実】 証明書の期限が切れています (期限: ${response.expiry})。`;
                    chipData.purpose = "【状況】 管理不備、あるいは偽サイトの可能性があります。";
                    chipData.risk = "【リスク】 暗号化が機能していない可能性があります。";
                    chipData.rec = "直ちに利用を中止してください。";
                    chipData.stats = null; // 期限切れはミュート不可
                }
                
                renderChip(field, chipData, false, null, chipData.stats);
            });
        } catch (e) {
            renderChip(field, chipData, false, null, chipData.stats);
        }
    }
}

// ... (attachChips, attachSubmitGuard, startGuard, stopGuard, Entry Point は変更なし)
// 省略せず記述が必要ですが、前回のFILE-022と同じです。
// コード全体を作成する際は、前回のファイル末尾を結合してください。

function attachChips() {
    const passwordFields = document.querySelectorAll(TARGET_SELECTORS);
    passwordFields.forEach(processField);
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