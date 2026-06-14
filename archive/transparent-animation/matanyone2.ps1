# Runs MatAnyone2 inside Ubuntu WSL with CUDA. Converts Windows paths to WSL paths.
param(
	[string]$ArgsJsonPath,

	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$MatanyoneArgs
)

$ErrorActionPreference = "Stop"

if ($ArgsJsonPath) {
	if (-not (Test-Path -LiteralPath $ArgsJsonPath)) {
		throw "MatAnyone2 args JSON file not found: $ArgsJsonPath"
	}
	$ParsedArgs = Get-Content -Raw -LiteralPath $ArgsJsonPath | ConvertFrom-Json
	$MatanyoneArgs = foreach ($Arg in $ParsedArgs) {
		[string]$Arg
	}
}

if ($MatanyoneArgs.Count -eq 0) {
	Write-Error "Usage: matanyone2.ps1 <matanyone2 CLI args, e.g. -i video.mp4 -m mask.png -o out --save-image>"
}

function Convert-ToWslPath {
	param([string]$WindowsPath)
	if ($WindowsPath -match '^[A-Za-z]:\\') {
		# wsl.exe/bash argument translation can treat backslashes as escapes before
		# wslpath sees the value. Forward-slash Windows paths are accepted by
		# wslpath and preserve spaces/special characters as a single argv value.
		$wslpathInput = $WindowsPath -replace '\\', '/'
		$converted = & wsl -d Ubuntu-24.04 -u emrec -- wslpath -a $wslpathInput
		if ($LASTEXITCODE -ne 0) {
			throw "wslpath failed for: $WindowsPath"
		}
		return $converted.Trim()
	}
	return $WindowsPath
}

$escapedArgs = @()
foreach ($arg in $MatanyoneArgs) {
	$wslArg = Convert-ToWslPath $arg
	$escapedArgs += ("'" + ($wslArg -replace "'", "'\\''") + "'")
}

$command = "cd ~/src/MatAnyone2 && source .venv/bin/activate && matanyone2 " + ($escapedArgs -join " ")
& wsl -d Ubuntu-24.04 -u emrec -- bash -lc $command
exit $LASTEXITCODE
