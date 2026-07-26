# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$singleline = [System.Text.RegularExpressions.RegexOptions]::Singleline
$verified = 0

function Assert-SourceDefault {
	param(
		[Parameter(Mandatory = $true)][string]$RelativePath,
		[Parameter(Mandatory = $true)][string]$Pattern,
		[Parameter(Mandatory = $true)][string]$Label
	)

	$path = Join-Path $repositoryRoot $RelativePath
	$content = Get-Content -LiteralPath $path -Raw
	if (-not [regex]::IsMatch($content, $Pattern, $singleline)) {
		throw "Fork default verification failed for $Label in $RelativePath."
	}

	$script:verified++
}

Assert-SourceDefault 'src/vs/platform/update/common/update.config.contribution.ts' "'update\.showReleaseNotes'\s*:\s*\{.{0,400}?default:\s*false" 'release notes'
Assert-SourceDefault 'src/vs/workbench/browser/workbench.contribution.ts' "'workbench\.tips\.enabled'\s*:\s*\{.{0,400}?'default':\s*false" 'editor watermark tips'
Assert-SourceDefault 'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts' "'chat\.tips\.enabled'\s*:\s*\{.{0,400}?default:\s*false" 'chat tips'
Assert-SourceDefault 'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts' "\[ChatConfiguration\.TitleBarSignInEnabled\]\s*:\s*\{.{0,400}?default:\s*false" 'chat title-bar sign-in'
Assert-SourceDefault 'src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts' "'extensions\.ignoreRecommendations'\s*:\s*\{.{0,400}?default:\s*true" 'extension recommendations'
Assert-SourceDefault 'src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution.ts' "'workbench\.welcomePage\.walkthroughs\.openOnInstall'\s*:\s*\{.{0,400}?default:\s*false" 'installed-extension walkthroughs'
Assert-SourceDefault 'src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution.ts' "'workbench\.startupEditor'\s*:\s*\{.{0,4000}?'default':\s*'none'" 'startup editor'
Assert-SourceDefault 'src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution.ts' "'workbench\.welcomePage\.experimentalOnboarding'\s*:\s*\{.{0,400}?default:\s*false" 'experimental onboarding'
Assert-SourceDefault 'src/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.ts' "if\s*\(this\.environmentService\.skipWelcome\)\s*\{\s*return;\s*\}\s*// Always open Welcome page" 'skip-welcome restored-walkthrough guard'
Assert-SourceDefault 'src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts' "\[WORKSPACE_TRUST_ENABLED\]\s*:\s*\{.{0,300}?default:\s*true" 'Workspace Trust enabled'
Assert-SourceDefault 'src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts' "\[WORKSPACE_TRUST_STARTUP_PROMPT\]\s*:\s*\{.{0,300}?default:\s*'never'" 'Workspace Trust startup prompt'
Assert-SourceDefault 'src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts' "\[WORKSPACE_TRUST_BANNER\]\s*:\s*\{.{0,300}?default:\s*'never'" 'Workspace Trust banner'
Assert-SourceDefault 'src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts' "\[WORKSPACE_TRUST_UNTRUSTED_FILES\]\s*:\s*\{.{0,300}?default:\s*'newWindow'" 'untrusted files'
Assert-SourceDefault 'src/vs/workbench/electron-browser/desktop.contribution.ts' "'window\.dialogStyle'\s*:\s*\{.{0,1200}?'enum':\s*\['notification',\s*'custom',\s*'native'\].{0,1200}?'default':\s*'notification'.{0,1200}?agentsWindow:\s*\{\s*default:\s*'notification'" 'notification dialog style'
Assert-SourceDefault 'src/vs/workbench/services/assignment/common/assignmentService.ts' "'workbench\.enableExperiments'\s*:\s*\{.{0,400}?'default':\s*false" 'experiments'

$copilotManifestPath = Join-Path $repositoryRoot 'extensions/copilot/package.json'
$copilotManifest = Get-Content -LiteralPath $copilotManifestPath -Raw | ConvertFrom-Json
$surveySettings = @()
foreach ($configuration in @($copilotManifest.contributes.configuration)) {
	$property = $configuration.properties.PSObject.Properties['github.copilot.chat.surveys.enabled']
	if ($property) {
		$surveySettings += $property.Value
	}
}
if ($surveySettings.Count -ne 1 -or $surveySettings[0].type -ne 'boolean' -or $surveySettings[0].default -ne $false) {
	throw 'Fork default verification failed for the Copilot survey opt-in setting.'
}
$verified++

$surveyServicePath = Join-Path $repositoryRoot 'extensions/copilot/src/platform/survey/vscode/surveyServiceImpl.ts'
$surveyService = Get-Content -LiteralPath $surveyServicePath -Raw
$surveyGuards = [regex]::Matches($surveyService, 'if\s*\(!this\.surveysEnabled\)').Count
if ($surveyGuards -lt 4 -or -not [regex]::IsMatch($surveyService, 'if\s*\(this\.surveysEnabled\)')) {
	throw "Expected the constructor opt-in and at least four Copilot survey suppression guards, found $surveyGuards suppression guards."
}
$verified++

Write-Host "Verified $verified fork defaults and safety guards."
