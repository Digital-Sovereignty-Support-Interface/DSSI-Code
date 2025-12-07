/**
 * DSSI Background Service (The Brain)
 * 責務: コンテンツスクリプトからの依頼を受け、高度な判定や外部通信を行う。
 * 現状: Chrome APIの制限により、証明書期限の直接取得は不可。
 * そのため、既知のテストサイトを用いて「警告機能の動作」を実証する。
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "CHECK_CERTIFICATE") {
        const url = new URL(request.url);
        
        // 🛡️ 模擬判定ロジック (Mock Logic)
        let certStatus = "valid";
        let expiryDate = "2099-12-31"; 

        // badssl.com を使ったテスト用分岐
        if (url.hostname === "expired.badssl.com") {
            certStatus = "expired";
            // 修正: これがテストデータであることを明記する
            expiryDate = "2015-04-12 (Simulated/Mock Data)"; 
        } else if (url.hostname === "self-signed.badssl.com") {
            certStatus = "invalid_issuer";
        }

        // 結果を即座に返す
        sendResponse({
            status: certStatus,
            expiry: expiryDate,
            issuer: "DSSI Local Check"
        });
    }
    
    // 非同期レスポンスのために true を返す必要がある
    return true; 
});