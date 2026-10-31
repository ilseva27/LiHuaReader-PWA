# 麗華小說 — iPhone PWA v1.0

一款不用 Mac、不必編譯 IPA、可以從 Windows 發布到 GitHub Pages 的繁體中文小說閱讀器。

## 功能

- 匯入 iPhone「檔案」中的 TXT（UTF-8、UTF-16、部分 Big5/GB18030）及 EPUB。
- EPUB 原始封面、目錄、章節索引；小說存在本機 IndexedDB。
- 直排（由上往下、由右往左）與橫排；點擊左／中／右區域翻頁或打開控制列。
- 繁體／簡體／原文切換（內附 ICU 字元對照及常見詞組，少量多義詞可能不精確）。
- 字體大小、粗體、行距／列距即時調整，米白、棕色、深色主題。
- 進度儲存；朗讀中保存語音片段位置，避免只保存頁首。
- iPhone Safari Web Speech API 系統中文語音；語速、可用音色、朗讀暫停與跟隨自動翻頁。
- 朗讀中啟用跟隨：左右點擊翻頁鎖定，中間仍可開啟選單；取消跟隨則可自由翻頁。
- 返回書架時停止朗讀；切換 App、鎖定螢幕時能否繼續發聲依 iOS 限制，**不保證背景播放**。
- 匯出／匯入整個書架（JSON）；首頁提供原創測試短篇。
- Service Worker 快取 App 外殼，可離線開啟已匯入的小說（第一次安裝需連線）。

## Windows 上傳 GitHub Pages

1. 先在 GitHub 建立新的 **Public** repository，例如 `LiHuaReader-PWA`（不要用原本 Android 專案，以免混淆）。
2. 將這個資料夾內的 **全部檔案與資料夾**（含 `vendor/`、`icons/`、`sw.js`、`manifest.webmanifest`）上傳到 repo **根目錄**。不要只上傳 ZIP。
3. 打開儲存庫 **Settings → Pages → Build and deployment**，Source 選 **Deploy from a branch**，Branch 選 **main**，Folder 選 **/(root)**，按 Save。
4. 部署成功後會有網址 `https://你的帳號.github.io/LiHuaReader-PWA/`。
5. 在 iPhone **Safari** 開啟網址，按「分享」→「加入主畫面」，如果看到「打開為網頁 App」請開啟；之後從主畫面開啟「麗華小說」。
6. 在 iPhone 進入「麗華小說」，按「匯入 TXT / EPUB」，從「檔案」選小說。請勿把小說本身上傳到公開 GitHub repository。

**本機 Windows 測試**：在這個資料夾執行 `python -m http.server 8000`，用電腦瀏覽器開啟 `http://localhost:8000`（不要直接雙擊 `index.html`，否則 Service Worker 與部分瀏覽器 API 會失效）。

## 限制與注意

- 本版語音僅採用 iPhone 系統 Web Speech API，不使用 Piper、Kokoro 或 Azure，也不必申請 API Key。
- **Safari Web Speech API 沒有可靠的背景朗讀保證。** 鎖螢幕或切換 App 可能中止當前段落，並可能無法進入下一段。若「關螢幕連續聽整本小說」是絕對要求，後續應測試預先產生音訊的方案或原生 iOS App。
- iPhone 可用語音種類由 iOS 系統提供；若沒有列出偏好的台灣中文音色，可到 iPhone「設定→輔助使用→朗讀內容／語音」下載系統語音，實際選單隨 iOS 版本而異。
- 網頁本機儲存可能被系統清理。**重要書籍請定期用「備份與還原」匯出 JSON**。
- 完全離線時，已快取的應用與已匯入的書能開啟；仍需先在有網路時完成一次載入。
- EPUB 以文字閱讀為主：支援一般 XHTML 章節及常見封面格式；固定版面、特殊排版、SVG 封面、DRM 加密 EPUB 未支援。
- TXT 不同來源的 Big5/GB18030 偵測可能不準，可事先將檔案轉 UTF-8 以得到最佳結果。
- Android v2.6 與 PWA 的資料庫不同，舊書不會自動搬移，請在 iPhone 重新匯入小說。
- 此版本是可部署的原始碼，尚未在真正 iPhone 上完成完整回歸測試。

## 開源套件

`vendor/jszip.min.js` 使用 JSZip 3.10.1（MIT / GPLv3 雙授權），授權文字見 `vendor/jszip-license.md`。字型採 iPhone 系統字型，專案未包含字型檔。
