# Runs MatAnyone2 inside Ubuntu WSL with CUDA. Converts Windows paths to WSL paths.
param(
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$MatanyoneArgs
)

$ErrorActionPreference = "Stop"

if ($MatanyoneArgs.Count -eq 0) {
	Write-Error "Usage: matanyone2.ps1 <matanyone2 CLI args, e.g. -i video.mp4 -m mask.png -o out --save-image>"
}

function Convert-ToWslPath {
	param([string]$WindowsPath)
	if ($WindowsPath -match '^[A-Za-z]:\\') {
		$converted = & wsl -d Ubuntu-24.04 -u emrec -- wslpath -a $WindowsPath
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

$command = "source ~/src/MatAnyone2/.venv/bin/activate && matanyone2 " + ($escapedArgs -join " ")
& wsl -d Ubuntu-24.04 -u emrec -- bash -lc $command
exit $LASTEXITCODE
