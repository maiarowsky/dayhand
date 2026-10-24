// Adds a Copy button to every <pre data-copy>. The page works the same without this script.

const RESET_AFTER_MS = 1500;

function addCopyButton(pre: HTMLPreElement): void {
  const wrap = document.createElement("div");
  wrap.className = "code-wrap";
  pre.replaceWith(wrap);
  wrap.append(pre);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.textContent = "Copy";
  button.setAttribute("aria-label", pre.dataset.copyLabel ?? "Copy the commands");
  const status = document.createElement("span");
  status.className = "visually-hidden";
  status.setAttribute("role", "status");
  wrap.append(button, status);

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText((pre.textContent ?? "").trim());
      button.textContent = "Copied";
      status.textContent = "Copied to the clipboard";
    } catch {
      button.textContent = "Select and copy";
      status.textContent = "Copying is blocked here; select the text instead";
    }
    setTimeout(() => {
      button.textContent = "Copy";
      status.textContent = "";
    }, RESET_AFTER_MS);
  });
}

if (navigator.clipboard && window.isSecureContext) {
  document.querySelectorAll<HTMLPreElement>("pre[data-copy]").forEach(addCopyButton);
}
