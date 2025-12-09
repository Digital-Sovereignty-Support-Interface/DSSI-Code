/**
 * DSSI Popup Logic (Phase 1 Final)
 * 責務: ON/OFF、粘性レベル(1-3)、リセットの制御。
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-guard');
  const statusText = document.getElementById('status-text');
  const levelPanel = document.getElementById('level-control-panel');
  const levelRange = document.getElementById('viscosity-range');
  const levelVal = document.getElementById('level-val');
  const levelDesc = document.getElementById('level-desc');
  const resetBtn = document.getElementById('reset-stats');

  // レベルごとの説明文定義
  const LEVEL_DESCS = {
    1: "静寂 (Silent): ガイドを非表示。送信ブロックのみ作動。",
    2: "標準 (Standard): 重要フィールドと送信リスクを検知。",
    3: "主権 (Sovereign): 全ての入力を監視対象とします。"
  };

  // 1. 初期ロード (Storage -> UI)
  chrome.storage.local.get(['dssiEnabled', 'dssiLevel'], (result) => {
    // デフォルト: Enabled=true, Level=2
    const isEnabled = result.dssiEnabled !== false;
    const currentLevel = result.dssiLevel || 2;

    updateMasterUI(isEnabled);
    updateLevelUI(currentLevel);
  });

  // 2. マスターON/OFF切り替え
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.storage.local.set({ dssiEnabled: isEnabled }, () => {
      updateMasterUI(isEnabled);
      // アクティブなタブに通知
      notifyTab({ action: "UPDATE_SETTINGS", enabled: isEnabled });
    });
  });

  // 3. レベルスライダー操作 (ドラッグ中)
  levelRange.addEventListener('input', () => {
    const level = parseInt(levelRange.value, 10);
    updateLevelUI(level);
  });

  // 4. レベル確定 (ドラッグ終了時)
  levelRange.addEventListener('change', () => {
    const level = parseInt(levelRange.value, 10);
    chrome.storage.local.set({ dssiLevel: level }, () => {
      // 設定変更を通知
      notifyTab({ action: "UPDATE_SETTINGS", level: level });
    });
  });

  // 5. リセットボタン
  resetBtn.addEventListener('click', () => {
    if(confirm("学習したミュート設定を全てリセットしますか？")) {
        chrome.storage.local.remove(['dssi_stats'], () => {
            notifyTab({ action: "RESET_GUARD" });
            
            // ボタンの見た目を一時的に変更して完了を通知
            const originalText = resetBtn.textContent;
            resetBtn.textContent = "✓ リセット完了";
            resetBtn.disabled = true;
            
            setTimeout(() => {
                resetBtn.textContent = originalText;
                resetBtn.disabled = false;
            }, 2000);
        });
    }
  });

  // --- Helpers ---

  function updateMasterUI(isEnabled) {
    toggle.checked = isEnabled;
    statusText.textContent = isEnabled ? "● Active" : "○ Inactive";
    statusText.style.color = isEnabled ? "#27ae60" : "#95a5a6";
    
    // OFF時はレベル操作をグレーアウトして無効化
    if (isEnabled) {
        levelPanel.style.opacity = "1";
        levelPanel.style.pointerEvents = "auto";
    } else {
        levelPanel.style.opacity = "0.5";
        levelPanel.style.pointerEvents = "none";
    }
  }

  function updateLevelUI(level) {
    levelRange.value = level;
    levelVal.textContent = `Level ${level}`;
    levelDesc.textContent = LEVEL_DESCS[level] || "";
  }

  function notifyTab(message) {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {
            // エラー無視 (content scriptがロードされていないページなど)
        });
      }
    });
  }
});