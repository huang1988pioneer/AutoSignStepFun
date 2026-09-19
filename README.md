# AutoSignStepFun

使用 GitHub Actions 自動完成 StepFun 每日簽到。工作流程每天在多個台北時間時段執行，也可以手動觸發；支援最多 33 個帳號，失敗時會保留截圖與每帳號結果供排查。

## 功能

- 每日自動執行，或從 GitHub Actions 手動執行
- 支援 1～33 個 StepFun 帳號；未設定 Secret 的編號會自動略過
- 優先使用 Playwright Storage State，也可使用 Cookie Header
- 開啟 StepFun 新人福利頁，點擊每日簽到（若頁面自動觸發也能直接偵測）
- 以官方 `daily_check_in` mission response 確認成功；「今日已簽到」會視為成功
- 每日排程只做簽到；開放平台（platform.stepfun.com）餘額查詢是另外手動觸發的附加功能
- 暫時失敗時最多重試 2 次，並上傳截圖 Artifact（保留 7 天）
- 不會嘗試繞過 OTP、Google 登入或 CAPTCHA

## 設定 GitHub Actions

### 1. 取得登入狀態

建議使用 Playwright Storage State。登入 StepFun 後執行：

```bash
npx playwright codegen --save-storage=auth.json https://chat.stepfun.com/
```

完成登入與必要的驗證後關閉瀏覽器，將 `auth.json` 轉為單行 Base64：

```bash
# macOS / Linux
base64 -w0 auth.json

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('auth.json'))
```

若無法使用 Storage State，也可在瀏覽器開發者工具 Network 面板中，複製 `chat.stepfun.com` 請求的完整 `Cookie` header。

### 2. 新增 Repository Secrets

前往 GitHub 儲存庫的 **Settings → Secrets and variables → Actions**，建立下列 Secrets：

| Secret | 用途 |
| --- | --- |
| `STEPFUN_STORAGE_STATE_B64_1` … `STEPFUN_STORAGE_STATE_B64_33` | 各帳號的 Base64 Storage State（建議） |
| `STEPFUN_COOKIE_1` … `STEPFUN_COOKIE_33` | 各帳號的 Cookie Header（可替代 Storage State） |
| `STEPFUN_PLATFORM_STORAGE_STATE_B64_1` … `_33` | 選用；開放平台餘額查詢專用的 Base64 Storage State |
| `STEPFUN_PLATFORM_COOKIE_1` … `_33` | 選用；開放平台餘額查詢專用的 Cookie Header |

每個帳號只要設定其中一種登入方式即可，且 Storage State 優先。開放平台的兩個 Secret 只有在手動查詢餘額、而該帳號的聊天登入狀態又無法讀取 `platform.stepfun.com` 時才需要；未設定時會直接沿用聊天登入狀態。workflow 會執行全部 33 個編號；未設定 Secret 的帳號會自動略過，不必連續編號。

可選擇建立同編號的 Actions Variables `STEPFUN_ACCOUNT_NAME_1` … `STEPFUN_ACCOUNT_NAME_33`，用來顯示帳號別名；未設定時會使用 `account-N`（前 3 個編號有內建預設名稱）。

請勿把 `auth.json`、Cookie 或任何登入憑證提交到儲存庫。

### 3. 手動驗證

開啟儲存庫的 **Actions** 分頁，選擇 **StepFun daily check-in**，再按 **Run workflow**。手動執行時可勾選 **Also read the open platform account balance**，才會順便查詢開放平台餘額；排程執行一律只做簽到。執行完成後，可在 Job Summary 查看每日彙總，並在該次 workflow 的 Artifacts 下載每帳號結果、截圖與 `stepfun-check-in-report`。

`daily-summary` 會使用 `GITHUB_TOKEN` 自動建立或更新 **`result` 分支**的 [`streaks.json`](https://github.com/huang1988pioneer/AutoSignStepFun/blob/result/streaks.json)，並將摘要檔附在 `stepfun-check-in-report`。只有此 job 取得 `contents: write` 權限；若儲存庫規則禁止 Actions 寫入該分支，發布步驟會失敗。

公開的 `streaks.json` 只包含顯示資料，不包含登入狀態、Cookie 或錯誤訊息。每個帳號提供 `account`、`name`、`label`、`status`、`finishedAt`、`currentPoints`、`remainingCredits`、`platformBalance`、`streak`、`lastCheckInDate` 與去重後的 `checkInDates`。`platformBalance` 只有在該次執行有查詢餘額時才有值，且只包含讀取狀態、幣別、時間與帳戶金額等金額欄位，不含診斷訊息。連續簽到以台北日期計算，同日重跑或已簽到不會重複加天。

## 每日自動執行時段

GitHub Actions 每天會在下列台北時間（UTC+8）各自執行一次：

| 時段 | 執行方式 |
| --- | --- |
| 05:00–06:00 | 整點觸發後，隨機等待 0–59 分鐘再開始 |
| 08:00 | 08:00 觸發執行 |
| 08:18 | 08:18 觸發執行 |
| 09:19 | 09:19 觸發執行 |
| 11:00 | 11:00 觸發執行 |
| 13:00–14:00 | 整點觸發後，隨機等待 0–59 分鐘再開始 |
| 21:00–22:00 | 整點觸發後，隨機等待 0–59 分鐘再開始 |

同一次 workflow 中，帳號 1 會先執行；後續帳號再各自隨機延遲 5–15 秒，避免 33 個帳號同時操作。GitHub 的排程本身也可能延遲。

## 在本機執行

需求：Node.js 22 與可安裝 Chromium 的環境。

```bash
npm install
npx playwright install chromium

# 二選一：設定 Cookie 或 Storage State
export STEPFUN_COOKIE='session=...'
# export STEPFUN_STORAGE_STATE_B64='...'

npm run claim
```

PowerShell：

```powershell
npm install
npx playwright install chromium
$env:STEPFUN_COOKIE = 'session=...'
# 或：$env:STEPFUN_STORAGE_STATE_B64 = '...'

npm run claim
```

可先檢查腳本語法與執行測試：

```bash
npm run check
npm test
```

本機結果預設寫入 `artifacts/claim-result.json`；截圖寫入 `screenshots/`。

### 手動查詢開放平台餘額

餘額查詢與每日簽到是分開的，需要時才執行：

```bash
npm run balance                 # 使用 STEPFUN_PLATFORM_STORAGE_STATE_B64 或 STEPFUN_STORAGE_STATE_B64
npm run balance -- auth-01.json # 或直接指定 Storage State 檔案
```

若要在簽到的同時一併查詢，可設定 `STEPFUN_PLATFORM_BALANCE=1` 再執行 `npm run claim`。

## 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `STEPFUN_STORAGE_STATE_B64` | 無 | Base64 編碼的 Playwright Storage State JSON |
| `STEPFUN_COOKIE` | 無 | 完整 Cookie Header |
| `STEPFUN_ACCOUNT_NAME` | `default` | 用於日誌與截圖檔名的帳號識別 |
| `STEPFUN_ACCOUNT_NUMBER` | 無 | 目前帳號編號，用於結果與 session rotation |
| `STEPFUN_MAX_RETRIES` | `2` | 最大嘗試次數 |
| `STEPFUN_SCREENSHOT_DIR` | `./screenshots` | 截圖輸出資料夾 |
| `STEPFUN_RESULT_DIR` | `./artifacts` | 結果輸出資料夾 |
| `STEPFUN_BROWSER` | `chromium` | `chromium`、`firefox` 或 `edge` |
| `STEPFUN_PLATFORM_BALANCE` | `0` | 設為 `1` 才會在簽到時一併讀取開放平台餘額 |
| `STEPFUN_PLATFORM_STORAGE_STATE_B64` | 無 | 選用；開放平台餘額查詢專用的 Storage State，未設定時沿用聊天登入狀態 |
| `STEPFUN_PLATFORM_COOKIE` | 無 | 選用；開放平台餘額查詢專用的 Cookie Header |
| `STEPFUN_SECRET_WRITE_TOKEN` | 無 | 可選；具備 Secrets 讀寫權限的 PAT，用於寫回更新後的 Storage State |

## 桌面登入工具

專案內含 Avalonia 桌面工具，可協助建立、複製並同步 Storage State：

```bash
dotnet run --project StepFunFlow/StepFunFlow.csproj
```

1. 選擇帳號編號，按下建立登入狀態。
2. 在開啟的瀏覽器完成 StepFun 登入，然後關閉瀏覽器。
3. 預設會自動同步到 GitHub Actions：登入狀態寫入 `STEPFUN_STORAGE_STATE_B64_N` Secret，帳號別名寫入 `STEPFUN_ACCOUNT_NAME_N` Variable；也可以關閉自動同步後改用手動按鈕或複製 Base64。

首次同步前，請在 PowerShell 執行 `gh auth login -h github.com`，並以具備此儲存庫 Actions Secrets 與 Variables 寫入權限的 GitHub 帳號完成登入。登入狀態會透過 GitHub CLI 的標準輸入傳送，不會出現在命令列、工具畫面或日誌中。

工具會優先使用電腦已安裝的 Microsoft Edge，其次是 Google Chrome；兩者都找不到時才會下載 Playwright Chromium。

## 疑難排解

- **登入狀態過期**：重新取得 Storage State 或 Cookie，並更新對應的 `STEPFUN_*` Secret。
- **沒有觀察到 `daily_check_in`**：到 workflow Artifact 查看 `daily-check-in-not-observed` 截圖；StepFun 頁面若改版，可能需要調整 `scripts/claim-daily-check-in.mjs` 的簽到控制項選擇器或 mission endpoint。
- **已簽到卻顯示失敗**：查看結果訊息；程式會辨識常見的「今日已簽到」文案，若服務回傳新的文案，可補到 `scripts/stepfun-mission.mjs`。
- **讀不到開放平台餘額**：`platform.stepfun.com` 與聊天站是各自獨立的登入。截圖會存成 `platform-balance-login-required`；請改設該帳號的 `STEPFUN_PLATFORM_STORAGE_STATE_B64_N`，或在擷取登入狀態時一併登入開放平台。
- **排程沒有準時執行**：GitHub Actions 的排程可能延遲，先手動執行驗證設定。
- **需要 OTP、Google 登入或 CAPTCHA**：先在本機正常完成登入，再更新 Storage State／Cookie；此專案不會自動繞過驗證。

## 安全提醒

登入憑證等同帳號存取權。僅將它們放在 GitHub Secrets 或本機環境變數中；若懷疑外洩，請立即撤銷 StepFun 登入工作階段並更新憑證。
