# e2e/fixtures/word-sample.docx 만들기 — 진짜 워드(COM)로 쓴 시험 문서 (docx-import.mjs가 읽는다).
# 워드 기본 스타일(문서 제목 · 제목 1 · 2 · 인용 · 캡션 · 글머리 · 번호 목록) · 굵게 · 기울임 · 빨강 · 링크 · 각주 · 가운데 맞춤 ·
# 머리 행 표(세로로 합친 칸) · 대체 텍스트 단 그림 · 쪽 나눔. 사용: powershell -File e2e/fixtures/make-word-sample.ps1
# 이미 띄운 워드가 있어도 건드리지 않는다 — 이 스크립트가 새로 띄운 워드만 끈다.
$ErrorActionPreference = 'Stop'
[string]$out = Join-Path $PSScriptRoot 'word-sample.docx'
$png = Join-Path $env:TEMP 'dn-word-sample.png'
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 120, 80
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(76, 110, 245))
$g.FillRectangle([System.Drawing.Brushes]::White, 20, 20, 40, 40)
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = New-Object -ComObject Word.Application
Start-Sleep -Milliseconds 300
$mine = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
$own = $mine.Count -gt 0
if ($own) { $word.Visible = $false; $word.DisplayAlerts = 0 }
$doc = $null
try {
  $doc = $word.Documents.Add()
  $sel = $word.Selection
  function Style([int]$id) { $sel.Style = $doc.Styles.Item($id) }
  function Para([int]$id, [string]$text) { Style $id; $sel.TypeText($text); $sel.TypeParagraph() }
  Para -63 '워드에서 만든 문서'          # 문서 제목
  Para -2 '첫째 장'                       # 제목 1
  Style -1
  $sel.TypeText('보통 글과 ')
  $sel.Font.Bold = 1; $sel.TypeText('굵게'); $sel.Font.Bold = 0
  $sel.TypeText(' · ')
  $sel.Font.Italic = 1; $sel.TypeText('기울임'); $sel.Font.Italic = 0
  $sel.TypeText(' · ')
  $sel.Font.Color = 255; $sel.TypeText('빨강'); $sel.Font.Color = -16777216
  $sel.TypeText(' · ')
  $doc.Hyperlinks.Add($sel.Range, 'https://example.org/', [Type]::Missing, [Type]::Missing, '링크') | Out-Null
  $sel.TypeText(' 끝')
  $sel.TypeParagraph()
  Para -49 '글머리 하나'                  # 글머리 기호 목록
  Para -55 '안쪽 글머리'                  # 글머리 기호 목록 2
  Para -49 '글머리 둘'
  Para -50 '번호 하나'                    # 번호 매기기 목록
  Para -50 '번호 둘'
  Style -1
  $sel.ParagraphFormat.Alignment = 1
  $sel.TypeText('가운데 문단'); $sel.TypeParagraph()
  $sel.ParagraphFormat.Alignment = 0
  Para -181 '인용 문단'                   # 인용
  Para -3 '표와 그림'                     # 제목 2
  Style -1
  $t = $doc.Tables.Add($sel.Range, 3, 3)
  $t.Borders.Enable = 1
  $cells = @(@('이름', '수량', '비고'), @('사과', '3', '합친 칸'), @('배', '5', ''))
  for ($r = 1; $r -le 3; $r++) { for ($c = 1; $c -le 3; $c++) { $t.Cell($r, $c).Range.Text = $cells[$r - 1][$c - 1] } }
  $t.Rows.Item(1).HeadingFormat = -1
  $t.Rows.Item(1).Range.Font.Bold = 1
  $t.Cell(2, 3).Merge($t.Cell(3, 3))
  $sel.EndKey(6) | Out-Null
  $sel.TypeParagraph()
  Style -1
  $pic = $sel.InlineShapes.AddPicture($png)
  $pic.AlternativeText = '파란 사각형'
  $sel.TypeParagraph()
  Para -35 '그림 1. 파란 사각형'           # 캡션
  Style -1
  $sel.InsertBreak(7)                      # 쪽 나눔
  $sel.TypeText('둘째 쪽 글')
  # 각주: 셋째 문단(보통 글 …) 끝에 — 쓰는 중에 넣으면 워드가 기호를 다른 자리(표 뒤)에 둔다
  $r = $doc.Paragraphs.Item(3).Range
  $r.MoveEnd(1, -1) | Out-Null
  $r.Collapse(0)
  $doc.Footnotes.Add($r, [Type]::Missing, '워드 각주') | Out-Null
  $fmt = 16 # wdFormatDocumentDefault (.docx) — 값으로 넘기면 숨은 워드가 저장에서 멈춘다
  $doc.SaveAs2([ref]$out, [ref]$fmt)
  "saved $out"
} finally {
  if ($doc) { try { $doc.Close([ref]0) } catch {} }
  if ($own) { try { $word.Quit() } catch {} }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  if ($own) { Start-Sleep -Milliseconds 800; foreach ($id in $mine) { Stop-Process -Id $id -ErrorAction SilentlyContinue } }
  Remove-Item $png -ErrorAction SilentlyContinue
}
