// Completion scripts. Each one hands the words before the cursor, plus the
// word being typed, to `hlm __complete`, which answers one candidate per line
// ("value<TAB>description") and a last line ":<directive>" (bit 2: no space
// after the value, bit 4: no file names). The same protocol as cobra's.

export const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type Shell = (typeof SHELLS)[number];

const bash = `# hlm completion for bash. Load it with: source <(hlm completion bash)
_hlm_complete() {
  local IFS=$'\\n' line directive
  local -a lines
  lines=($(hlm __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)) || return 0
  [[ \${#lines[@]} -eq 0 ]] && return 0
  directive=\${lines[\${#lines[@]}-1]#:}
  unset 'lines[\${#lines[@]}-1]'
  COMPREPLY=()
  for line in "\${lines[@]}"; do COMPREPLY+=("\${line%%$'\\t'*}"); done
  if (( directive & 2 )); then compopt -o nospace 2>/dev/null; fi
  if (( \${#COMPREPLY[@]} == 0 && !(directive & 4) )); then compopt -o default 2>/dev/null; fi
  return 0
}
complete -F _hlm_complete hlm
`;

const zsh = `#compdef hlm
# hlm completion for zsh. Save it as _hlm in a folder on $fpath, or: source <(hlm completion zsh)
_hlm() {
  local -a lines described
  local line directive value
  lines=("\${(@f)$(hlm __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  directive=\${lines[-1]#:}
  lines=("\${(@)lines[1,-2]}")
  for line in "\${lines[@]}"; do
    [[ -z $line ]] && continue
    value=\${line%%$'\\t'*}
    if [[ $line == *$'\\t'* ]]; then described+=("\${value//:/\\\\:}:\${line#*$'\\t'}"); else described+=("\${value//:/\\\\:}"); fi
  done
  if (( \${#described} )); then
    if (( directive & 2 )); then _describe -t hlm hlm described -S ''; else _describe -t hlm hlm described; fi
  elif (( !(directive & 4) )); then
    _files
  fi
}
if [[ "\${funcstack[1]}" == _hlm ]]; then _hlm "$@"; else compdef _hlm hlm; fi
`;

const fish = `# hlm completion for fish. Save it as ~/.config/fish/completions/hlm.fish
function __hlm_complete
    set -l words (commandline -opc)
    set -e words[1]
    set -l current (commandline -ct)
    set -l out (hlm __complete $words "$current" 2>/dev/null)
    test (count $out) -eq 0; and return
    set -l directive (string replace -r '^:' '' -- $out[-1])
    set -e out[-1]
    if test (count $out) -eq 0; and not contains -- $directive 4 6
        __fish_complete_path "$current"
        return
    end
    printf '%s\\n' $out
end
complete -c hlm -f -a '(__hlm_complete)'
`;

const powershell = `# hlm completion for PowerShell. Load it with: hlm completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName 'hlm' -ScriptBlock {
    param($WordToComplete, $CommandAst, $CursorPosition)
    $words = @($CommandAst.CommandElements | Select-Object -Skip 1 |
        Where-Object { $_.Extent.StartOffset -lt $CursorPosition } | ForEach-Object { $_.Extent.Text })
    # An empty argument does not reach native programs in every PowerShell version; "" stands for it.
    if ($WordToComplete -eq '') { $words += '""' }
    $out = @(& hlm __complete @words 2>$null)
    if ($out.Count -eq 0) { return }
    $directive = [int]($out[-1].TrimStart(':'))
    $candidates = if ($out.Count -gt 1) { $out[0..($out.Count - 2)] } else { @() }
    foreach ($line in $candidates) {
        $parts = $line -split "\`t", 2
        $value = $parts[0]
        $tip = if ($parts.Count -gt 1 -and $parts[1]) { $parts[1] } else { $value }
        $text = if ($value -match '\\s') { "'" + $value + "'" } else { $value }
        [System.Management.Automation.CompletionResult]::new($text, $value, 'ParameterValue', $tip)
    }
}
`;

const SCRIPTS: Record<Shell, string> = { bash, zsh, fish, powershell };

export const completionScript = (shell: Shell) => SCRIPTS[shell];
