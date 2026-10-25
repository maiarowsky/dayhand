// Valid project names whose punctuation must remain data in shell completion.
export const HOSTILE_PROJECT_NAMES = [
  "q00 apostrophe's shop",
  "q01 backtick`word",
  "q02 $(Write-Output INJECTED)",
  "q03;Write-Output",
  'q04 "double" (round)',
  "q05\\path:with space",
  "q06'; Write-Output INJECTED; 'end",
  "q07$(Write-Output)",
  "q08`nINJECTED",
];
