# WMCX 手順解析引擎 (Hand Hint Engine)

為 [Web mai Chart X](https://github.com/Susuy0725/web-mai-chart-x) 開發的官方 Extension API v1 擴充程式，參照 `web-mai-chart-x` 的 `hand` 分支演算法實作，並以非侵入式疊加圖層架構整合至 `main` 分支的擴充程式系統。

## 功能特色

- **自動手順推算引擎（Beam Search DP, $B = 8$）**：
  - 將 Slide 拆分為「星星頭擊打 (`t = note.time`)」與「滑動啟動 (`t = note.time + slideDelay`)」兩階段處理，避免滑動延遲前誤換手。
  - 預先偵測單向圓周刷鍵區段（順時針 `1→8` / 逆時針 `8→1`），保持單手順刷不斷手。
  - 考量 Hold / Slide 佔用鎖定、移動距離與速度成本、雙押不交叉、半場偏好、同手高速異鍵連打懲罰及同鍵節奏連打慣性。
  - 支援 WiFi (`w` slide) 自動指派為雙手 (`BOTH`) 並分類左右翼軌跡。
  - 支援多條並發連鎖 Slide（依 `index`、`baseTime`、`endPos` 與 `endTime` 精準匹配）。
  - **零修改凍結快照**：分析結果儲存於 `WeakMap`，不直接改寫 `ctx.chart.getSnapshot()` 所回傳的凍結音符物件。
- **主圓盤即時視覺化疊加 (`main` / `afterNotes`)**：
  - **虛擬雙手游標與軌跡**：繪製 `L`（天藍）／`R`（珊瑚紅）游標、按壓發光圈、7 點漸層拖尾殘影，以及下一個目標的虛線導引提示。
  - **音符手順角標與色環**：依遊戲速度與 `middleDistance` 同步追蹤外圈 Tap / Star / Hold、Touch / TouchHold 與移動中 Slide 星星，顯示 `L` / `R` / `LR` 角標與選用色環。
- **視覺化編輯器提示 (`visual` / `afterNotes`)**：
  - 於時間軸軌道上在各音符旁繪製 `L` / `R` / `LR` 手順徽章（手動指定手順將以黃框標示）。
- **原生選單、指令與多語系支援**：
  - 頂欄拼圖選單提供「手順解析引擎設定」、「切換虛擬雙手游標」與「檢視目前譜面手順統計」。
  - 內建 `zh-TW`、`zh-CN`、`en`、`ja`、`ko` 五語系字典與 Popover 宣告式設定面板。

## 宣告權限 (`manifest.json`)

依最小權限原則僅申請必要權限：

- `chart:read`：讀取目前譜面音符唯讀快照進行手順分析。
- `view:read` / `playback:read` / `settings:read`：同步速度、大小與視覺編輯器圖層狀態。
- `render:overlay`：於主畫布與視覺編輯器註冊 `afterNotes` 疊加圖層。
- `commands:register` / `events:subscribe`：註冊快捷指令與訂閱譜面重解碼/設定變更事件。
- `ui:menu` / `ui:popover` / `ui:toast` / `i18n:register` / `storage`：整合頂欄選單、設定彈窗、提示訊息、多語系與設定保存。

## 打包與安裝方式

### 1. 建置 WERP 儲存庫（推薦）

執行建置腳本，自動打包 `.zip` 至 `Extensions/` 並計算 SHA-256 更新 `index.json`：

```powershell
.\scripts\build-repo.ps1
```

發布至 GitHub Pages 後，可在 Web mai Chart X 的「擴充程式來源」中加入以下索引網址：

```text
https://<你的帳號>.github.io/wmcx-exd-sus/index.json
```

### 2. 手動打包為 `.zip`

執行 PowerShell 打包腳本：

```powershell
.\scripts\pack.ps1
```

或手動壓縮根目錄的 `manifest.json` 與 `index.js`：

```powershell
Compress-Archive -Path "manifest.json", "index.js" -DestinationPath "Extensions\com.susuy0725.hand-hint-engine-1.0.0.zip" -Force
```

### 3. 安裝至 Web mai Chart X

1. 開啟 Web mai Chart X 編輯器。
2. 點擊頂欄右側拼圖圖示 → **管理擴充程式**。
3. 透過 WERP 儲存庫索引網址訂閱，或點擊右下角 **匯入擴充程式** 選取打包後的 `.zip` 檔案並確認授權啟用。

## 開發與測試

使用 Node.js 內建測試執行器驗證演算法、擴充整合與 WERP 索引規範：

```bash
node --test tests/*.test.mjs
```
