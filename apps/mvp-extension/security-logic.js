// security-logic.js

/**
 * security-logic.js
 * DSSI セキュリティロジックの中核モジュール
 * 責務: 通信監視、データ変換（伏せ字化）、整合性検査
 * 構造: 部品（Parts）、道具（Tools）、インターフェース（職人向け）
 * 哲学: "Trust, but Verify." / "Defense in Depth."
 */

const DSSI_Security = {
    // ==========================================
    // 1. 部品（Parts）の層
    // ==========================================
    Parts: {
        TrafficScanner: {
            observedRequests: [],
            isStarted: false,

            start: function() {
                if (this.isStarted) return;
                const self = this;

                // ① fetchのフック
                const originalFetch = window.fetch;
                window.fetch = async (...args) => {
                    const url = args[0];
                    const options = args[1];
                    self._log('fetch', url, options?.body);
                    return originalFetch(...args);
                };

                // ② XMLHttpRequest (古典的だが強力な漏洩路) のフック
                const originalOpen = XMLHttpRequest.prototype.open;
                const originalSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function(method, url) {
                    this._url = url;
                    return originalOpen.apply(this, arguments);
                };
                XMLHttpRequest.prototype.send = function(body) {
                    self._log('xhr', this._url, body);
                    return originalSend.apply(this, arguments);
                };

                // ③ Beacon (ページを閉じる際の送信) のフック
                const originalBeacon = navigator.sendBeacon;
                navigator.sendBeacon = function(url, data) {
                    self._log('beacon', url, data);
                    return originalBeacon.apply(this, arguments);
                };

                this.isStarted = true;
                console.log("🛡️ DSSI Scanner: All eyes open (fetch, XHR, Beacon).");
            },

            _log: function(type, url, data) {
                let payload = "";
                try {
                    payload = typeof data === 'string' ? data : JSON.stringify(data);
                } catch(e) { payload = "[Complex Data]"; }

                this.observedRequests.push({
                    type,
                    url: String(url),
                    payload: payload,
                    time: Date.now()
                });
            }
        },
            // ★新規: おとり生成部品
        DecoyFactory: {
            generate: function() {
                // 推測されにくい、かつユニークな囮タグ
                return `dssi_decoy_${Math.random().toString(36).slice(2, 9)}`;
            }
        },
        
        Transformer: {
            // ① 送信したくない文字列の定義（ここがMY_SECRETS）
            secrets: {
                "テスト": "[TEST_MASK]",
                "清水克敏": "[PERSON_A]",
                "清水": "[PERSON_B]",
                "清水 克敏": "[PERSON_C]",
                "清水　克敏": "[PERSON_D]",
                "O.A.E.株式会社": "[COMPANY_RED]"
            },

            // ② 伏せ字処理の実行メソッド
            applyMask: function(text) {
                let shieldedText = text;
                let mapping = {};
                let count = 0;

                // 1. 自動検知（メールアドレスや電話番号などのパターン）
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

                // 2. 秘密辞書（MY_SECRETS）による置換
                for (const [realName, placeholder] of Object.entries(this.secrets)) {
                    if (!realName || realName.trim() === "") continue;
                    
                    // 正規表現のメタ文字をエスケープ
                    const escaped = realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const re = new RegExp(escaped, 'g');
                    
                    const matches = shieldedText.match(re);
                    if (matches) {
                        count += matches.length;
                        mapping[placeholder] = realName;
                        shieldedText = shieldedText.replace(re, placeholder);
                    }
                }

                return { 
                    shieldedText: shieldedText, 
                    mapping: mapping, 
                    count: count 
                };
            }
        },
    },

// ==========================================
    // 2. 道具（Tools）の層
    // ==========================================
    IntegrityChecker: {
        /**
         * 照合と不可知性の判定
         * @param {string} rawValue - ユーザーの生入力
         * @param {string} decoyValue - 混ぜ込んだおとり
         */
        verify: function(rawValue, decoyValue) {
            const logs = DSSI_Security.Parts.TrafficScanner.observedRequests;
            
            const findInLogs = (val) => logs.some(log => log.payload && log.payload.includes(val));

            const rawDetected = findInLogs(rawValue);
            const decoyDetected = findInLogs(decoyValue);

            // 判定ロジック（不可知性の優先）
            
            // ケースA: おとりすら通信に乗っていない（＝やましい隠蔽、または未知の送信手法）
            if (decoyValue && !decoyDetected) {
                return {
                    status: "CRITICAL_UNKNOWN",
                    message: "【警告】おとりデータの送信が確認できません。通信を隠蔽するスクリプト、または未知の経路（キーロガー等）が介在している可能性があります。"
                };
            }

            // ケースB: 生データだけが通信に乗っていない（＝おとりだけ選別して送っている？）
            if (!rawDetected && decoyDetected) {
                return {
                    status: "SUSPICIOUS_FILTERING",
                    message: "【注意】おとりデータは確認されましたが、本来の入力が通常の通信に乗っていません。不自然なデータ選別が行われている可能性があります。"
                };
            }

            // ケースC: どちらも確認できた（＝通常の挙動）
            if (rawDetected) {
                return { status: "NORMAL", message: "既知の通信経路を通じた送信を確認しました。" };
            }

            // ケースD: 何もわからない
            return { status: "INDETERMINATE", message: "通信の追跡結果が不十分です。安全性を確定できません。" };
        }
    },

    // ==========================================
    // 3. インターフェース (職人向け)
    // ==========================================
    
    // おとりを生成する
    createDecoy: function() {
        return this.Parts.DecoyFactory.generate();
    },

    // 最終的な安全性の確認
    validateTransmission: function(raw, decoy) {
        return this.IntegrityChecker.verify(raw, decoy);
    },

    // 利用者（職人）向けインターフェース
    applyShield: function(text) {
        // Parts.Transformer 部品を呼び出して結果を返す
        return this.Parts.Transformer.applyMask(text);
    }
};

DSSI_Security.Parts.TrafficScanner.start();