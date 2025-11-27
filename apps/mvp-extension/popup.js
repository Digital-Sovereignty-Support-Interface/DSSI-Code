/**
 * DSSI Popup Logic
 * 責務: ユーザーの意思（ON/OFF）を受け取り、永続化し、現行のタブに即時反映させる。
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-guard');
  const statusText = document.getElementById('status-text');

  // 1. 初期状態の読み込み (Storage -> UI)
  // デフォルトは true (有効) とみなす
  chrome.storage.local.get(['dssiEnabled'], (result) => {
    const isEnabled = result.dssiEnabled !== false; 
    updateUI(isEnabled);
  });

  // 2. スイッチ切り替え時の処理 (UI -> Storage & Content Script)
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    
    // A. 設定を保存（次回以降のため）
    chrome.storage.local.set({ dssiEnabled: isEnabled }, () => {
      updateUI(isEnabled);
      
      // B. アクティブなタブに通知して即座に反映（今のページのため）
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "TOGGLE_GUARD",
            enabled: isEnabled
          });
        }
      });
    });
  });

  // UIの表示更新ヘルパー
  function updateUI(isEnabled) {
    toggle.checked = isEnabled;
    statusText.textContent = isEnabled ? "● Active" : "○ Inactive";
    statusText.style.color = isEnabled ? "#27ae60" : "#95a5a6";
  }
});