<#
.SYNOPSIS
  Export Insta360 360° walks as sharp as the camera allows, with the Insta360 Media SDK on Windows,
  so the Virtual Bazaar's title reader can read as many book titles as possible.

.DESCRIPTION
  The owner, 2026-11-04: "I have the insta360 SDK on windows can you write a power shell so our picture
  quality can be improved, so most book titles turn readable?"

  What limits reading a title is how many pixels a letter gets. Insta360 Studio's export on the owner's
  laptop came out at 5760 x 2880, about 16 pixels a degree: a spine's letters about 10 pixels tall. This
  script exports from the camera's own .insv files with the SDK at the camera's full size (8K = 7680 x 3840,
  about 21 pixels a degree), at a high bitrate (less compression smear on fine print), with the best
  stitching, and with the stabilisation shoppers need. It does NOT add detail the camera did not record:
  expect more titles readable on covers and big spines, not every small spine.

  ⚠️ CHECK THE OPTION NAMES ONCE: Insta360 has renamed them between SDK versions. Run
       .\export-sharp.ps1 -ShowHelp
  and compare with the names in the $Options block below; change any that differ.

.EXAMPLE
  .\export-sharp.ps1 -SdkExe "C:\Insta360\MediaSDK\bin\MediaSDKTest.exe" -InputDir "D:\Bookshop" -OutputDir "D:\Bookshop\sharp"

.EXAMPLE
  .\export-sharp.ps1 -SdkExe "C:\Insta360\MediaSDK\bin\MediaSDKTest.exe" -ShowHelp
#>
param(
  # The SDK's command-line program (in the SDK's bin folder; often MediaSDKTest.exe).
  [Parameter(Mandatory = $true)] [string] $SdkExe,
  # Folder with the camera's .insv files (copied from the SD card, untouched).
  [string] $InputDir = ".",
  # Where the sharp .mp4 files go (one per recording).
  [string] $OutputDir = ".\sharp",
  # Full size of the camera: 7680x3840 for 8K (X4, X5, X6). Use 5760x2880 if the camera recorded 5.7K.
  [string] $Size = "7680x3840",
  # Bits per second: 200 Mb/s keeps fine print from turning to mush (the files are big: ~1.5 GB a minute).
  [int64] $Bitrate = 200000000,
  # aistitch is the best seam (needs the SDK's AI model file); optflow is the next best and needs nothing extra.
  [ValidateSet("aistitch", "optflow", "dynamicstitch", "template")] [string] $Stitch = "optflow",
  # For aistitch: the model file that came with the SDK (e.g. ...\modelfile\ai_stitcher_model_v2.ins).
  [string] $AiModel = "",
  # Print the SDK's own list of options and stop.
  [switch] $ShowHelp
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $SdkExe)) { throw "The SDK program is not at '$SdkExe'. Point -SdkExe at it (in the SDK's bin folder)." }
if ($ShowHelp) { & $SdkExe -help; exit 0 }
if ($Stitch -eq "aistitch" -and -not (Test-Path $AiModel)) { throw "aistitch needs -AiModel: the .ins model file that came with the SDK. Or use -Stitch optflow." }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# A recording is one .insv (newer cameras) or a pair: ..._00_NNN.insv and ..._10_NNN.insv (one per lens).
$files = Get-ChildItem -Path $InputDir -Filter *.insv | Sort-Object Name
if (-not $files) { throw "No .insv files in '$InputDir'. Copy them from the camera's SD card (DCIM\Camera01)." }
$recordings = @{}
foreach ($f in $files) {
  $key = $f.BaseName -replace "_(00|10)_", "_xx_"
  if (-not $recordings.ContainsKey($key)) { $recordings[$key] = @() }
  $recordings[$key] += $f.FullName
}

$done = 0; $failed = @()
foreach ($key in $recordings.Keys | Sort-Object) {
  $inputs = $recordings[$key] | Sort-Object   # _00_ before _10_
  $out = Join-Path $OutputDir (($key -replace "_xx_", "_") + "-sharp.mp4")
  if (Test-Path $out) { Write-Host "= $out (already there)"; continue }

  # ⚠️ The option names: check them with -ShowHelp (see above).
  $Options = @(
    "-inputs") + $inputs + @(
    "-output", $out,
    "-stitch_type", $Stitch,
    "-output_size", $Size,
    "-bitrate", "$Bitrate",
    "-enable_h265_encoder",     # H.265: the same bitrate holds more detail; the bazaar accepts H.265
    "-enable_flowstate",        # stabilisation: shoppers walk it, the tags follow it
    "-enable_directionlock",    # the view keeps facing the way the photographer walked
    "-enable_deflicker"         # shop lights (60 Hz in Canada) do not pulse
    # Not on purpose: -enable_denoise (smooths fine print away) and -enable_colorplus (no detail, only colour).
  )
  if ($Stitch -eq "aistitch") { $Options += @("-ai_stitching_model", $AiModel) }

  Write-Host "→ $key  ($($inputs.Count) file(s))  →  $out"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $SdkExe @Options
  $sw.Stop()
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) {
    Write-Warning "Failed ($LASTEXITCODE) after $([int]$sw.Elapsed.TotalMinutes) min: $key"
    $failed += $key
    continue
  }
  $mb = [int]((Get-Item $out).Length / 1MB)
  Write-Host "✓ $out  ($mb MB, $([int]$sw.Elapsed.TotalMinutes) min)"
  # With ffprobe on the PATH, say what came out: it must be 2:1 and the size asked for.
  if (Get-Command ffprobe -ErrorAction SilentlyContinue) {
    $info = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,r_frame_rate -of csv=p=0 $out
    Write-Host "  $info   (width,height,codec,frame rate)"
  }
  $done++
}

Write-Host ""
Write-Host "$done exported to $OutputDir$(if ($failed) { "; failed: $($failed -join ', ')" })."
Write-Host "Next: upload each *-sharp.mp4 as the store's video on vbazaar.app/stores/<store>."
