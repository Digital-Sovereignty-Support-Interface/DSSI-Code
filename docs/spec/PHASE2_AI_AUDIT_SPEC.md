# Phase 2: AI Audit Engine Specification (D-FIP)

**Protocol:** DSSI - Facts over Interpretation Protocol (D-FIP)
**Status:** Draft
**Target:** Utilization of LLM as a "Fact Extractor"

---

## 1. 概要 (Overview)

本仕様書は、利用規約およびプライバシーポリシーからリスク情報を抽出するAIエンジンの技術仕様を定義する。
憲章に基づき、AIは「解釈・評価」を行わず、指定されたリスク項目に該当する「原文の引用」のみを行う。

## 2. データフロー (Data Flow)

1. **Capture (Content Script):**

    * ユーザーの明示的な操作（ボタン押下）により、ページ内の規約テキスト（`<article>`, `main`等）を抽出。

2. **Transport (Background):**

    * 抽出されたテキストをバックグラウンドへ送信。
    * ユーザー設定されたAPIキーを用いて、外部LLM APIへリクエスト。

    ```Plaintext
    You are the "Fact Extractor" for DSSI.
    Your goal is to extract sentences from the provided text that match specific risk categories.
    DO NOT interpret, evaluate, or summarize.
    ONLY output the raw "quote" and the "section" header.

    Target Categories:
    1. RISK_DATA_SHARING: Sharing user data with third parties.
    2. RISK_AUTO_RENEWAL: Automatic subscription renewal.
    3. RISK_COPYRIGHT_TRANSFER: Transfer of user copyright to the service.
    4. RISK_NO_WARRANTY: Excessive disclaimer of liability.

    Output Format: JSON Array only.
    [{"category_id": "...", "quote": "...", "section": "..."}]
    If no relevant text is found, output [].
    ```

3. **Extraction (LLM):**
    * システムプロンプト（後述）に基づき、事実抽出を実行。
    * 出力は厳格なJSONフォーマットのみを許可。

4. **Contextualization (Local Logic):**
    * 返却されたJSONに対し、DSSI内部の静的データベースから「公理的解説」を付与。

5. **Presentation (UI):**
    * サイドバーまたはポップアップにて、引用文と解説を表示。

---

## 3. インターフェース定義 (Schema)

### 3.1 LLMへの入力 (Input Prompt)

* **System Instruction:** D-FIP準拠の厳格な役割定義。
* **User Message:** 規約テキスト（チャンク分割が必要な場合は分割して送信）。

### 3.2 LLMからの出力 (Output JSON)

AIは以下のスキーマに準拠したJSON配列のみを返す。

```json
  {
    "category_id": "RISK_DATA_SHARING",
    "quote": "当社は、お客様の個人情報を提携パートナーと共有する場合があります。",
    "section": "第3条 データの利用"
  },
  {
    "category_id": "RISK_AUTO_RENEWAL",
    "quote": "本契約は、解約の申し出がない限り自動的に更新されます。",
    "section": "第5条 契約期間"
  }

