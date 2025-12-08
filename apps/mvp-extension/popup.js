/**
 * DSSI Popup Logic
 * 責務: ユーザーの意思（ON/OFF、リセット）を受け取り、永続化し、反映させる。
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-guard');
  const statusText = document.getElementById('status-text');
  const resetBtn = document.getElementById('reset-stats');

  // 初期状態読み込み
  chrome.storage.local.get(['dssiEnabled'], (result) => {
    const isEnabled = result.dssiEnabled !== false; 
    updateUI(isEnabled);
  });

  // スイッチ切り替え
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.storage.local.set({ dssiEnabled: isEnabled }, () => {
      updateUI(isEnabled);
      sendMessageToActiveTab({ action: "TOGGLE_GUARD", enabled: isEnabled });
    });
  });

  // リセットボタン（ミュート解除）
  resetBtn.addEventListener('click', () => {
    if(confirm("非表示（ミュート）にしたガイドをすべて復活させますか？")) {
        // 統計情報をクリア
        chrome.storage.local.remove(['dssi_stats'], () => {
            alert("リセットしました。ページを更新するとガイドが再表示されます。");
            // 念のため再読み込みを促す
            resetBtn.textContent = "✓ リセット完了";
            setTimeout(() => resetBtn.textContent = "↺ 非表示にしたガイドをリセット", 2000);
        });
    }
  });

  function updateUI(isEnabled) {
    toggle.checked = isEnabled;
    statusText.textContent = isEnabled ? "● Active" : "○ Inactive";
    statusText.style.color = isEnabled ? "#27ae60" : "#95a5a6";
  }

  function sendMessageToActiveTab(message) {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {
            // エラー無視 (content scriptがロードされていないページなど)
        });
      }
    });
  }
});