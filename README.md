# 嵌字台

快速漫畫漢化嵌字一站式全流程工具，皆可於瀏覽器中操作：支持 AI 一鍵識別內容、插入翻譯並匯出高品質 PNG。所有處理均於本地完成，資料不會離開您的電腦。

翻譯可無縫對接符合 OpenAI 規範的 API，文字辨識則預設採用本地 OCR，無需外部上傳。

## 安裝（Windows）

1. 安裝 [Python 3.10 或更新](https://www.python.org/downloads/)。安裝畫面請勾選 **Add python.exe to PATH**。
2. 下載這個專案：GitHub 頁面按 **Code → Download ZIP**，解壓縮。
3. 雙擊 `啟動.bat`。第一次會安裝套件，可能要幾分鐘。
4. 瀏覽器應會自動打開 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)。沒有的話請手動開這個網址。

關掉黑色視窗即結束。下次只要再雙擊 `啟動.bat`。

已有 Python 的人也可以在專案資料夾執行：

```bat
python -m pip install -r requirements.txt
python app.py
```

## 如何開始

1. 建立專案：點選 **新建**，選擇一個空資料夾作為專案目錄，所有漫畫圖像將儲存於此。
2. 匯入漫畫頁面：按 **匯入圖片** 新增頁面。
3. AI 翻譯設定：「API 設定」中填入 OpenAI 相容 API 的位址、模型名稱與金鑰。

## 系統需求

- Windows 10 或 11（也可在其他系統用 `python app.py`）
- Python 3.10+
- 本機 OCR 第一次執行會下載模型，需要網路
