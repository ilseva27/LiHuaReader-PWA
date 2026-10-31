# 麗華小說 iPhone PWA v1.0.4 — 更多音色與背景播放說明

本版基於 **v1.0.3 穩定版**，只修改 iPhone 語音選項，不變更書架資料格式、TXT／EPUB 匯入、翻頁、閱讀位置、文字轉換或跟隨朗讀邏輯。

## 新增
- iPhone 中文語音列表顯示可用數量；按「重新搜尋可用聲音」重新讀取 Safari 的 `speechSynthesis.getVoices()`。
- 可選擇列出其他語言的系統語音（**不代表能正確朗讀中文**）。
- 新增「聲音音高」0.70～1.30 倍（音色調整，不是增加聲優）。
- 新增 iPhone「設定 → 輔助使用 → 閱讀與朗讀 → 聲音」的操作指引，下載新聲音後回到 App 重新搜尋。
- 保留原有試聽與語速調整。

## 背景朗讀限制（重要）
本版仍使用 iPhone Safari 的 Web Speech API（`speechSynthesis`）。**不能保證切換 App 或關閉螢幕後持續朗讀**，也不能藉由 Media Session 或隱藏音訊偽裝成持續背景朗讀。若需要穩定背景播放，需採「先生成／取得 MP3、M4A 等音訊 → HTML 音訊播放器」；這需要真正的語音音訊來源或受信任的雲端音訊合成服務，並非現在的 iPhone 內建 Web Speech API 可直接匯出。

## 更新 GitHub Pages
1. 先在舊版的「備份與還原」匯出備份；不要刪除 iPhone App 或清除 Safari 網站資料。
2. 將本 ZIP **更新檔**（`app.js`、`index.html`、`styles.css`、`sw.js`、`library.js`、`package.json`、`README.md`）上傳至同一 Repository 的相同路徑，取代同名檔。
3. 等 Pages 部署完成，用 Safari 開啟原網址加 `?v=104`，確認書架底部顯示 `v1.0.4`。再重新啟動主畫面 App。
4. 進入「更多設定」，按「重新搜尋可用聲音」。

## 測試與風險
已做 JS 語法、原有 Node 測試、靜態程式一致性檢查。尚未在真實 iPhone 上驗證不同語音是否會出現在 Safari 及背景狀態。PWA 與 Safari 分頁的資料儲存可能不同，請盡量從原主畫面 App 使用及備份。
