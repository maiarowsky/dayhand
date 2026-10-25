// Sends the Dayhand Cloud waitlist form to /api/waitlist and shows the answer in the form. Without this script the
// form is hidden (@media (scripting: none)), so an address never goes anywhere by a plain form submit.

const SOURCE = "home";
const SENDING = "Sending…";
const OFFLINE = "Your address could not be sent. Check your connection and try again.";
const UNREADABLE = "Something went wrong on our side, so you're not on the list yet. Try again later.";
const INVALID = "Enter an email address, such as you@example.com.";

const openedAt = performance.now();

function showStatus(status: HTMLElement, message: string, state: "ok" | "error" | "busy"): void {
  status.textContent = message;
  status.dataset.state = state;
}

async function send(form: HTMLFormElement, email: HTMLInputElement, status: HTMLElement): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  const website = form.querySelector<HTMLInputElement>("input[name=website]");
  if (!email.checkValidity()) {
    email.setAttribute("aria-invalid", "true");
    showStatus(status, INVALID, "error");
    email.focus();
    return;
  }
  email.removeAttribute("aria-invalid");
  if (button) button.disabled = true;
  showStatus(status, SENDING, "busy");
  try {
    const response = await fetch(form.action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email.value,
        website: website?.value ?? "",
        elapsedMs: Math.round(performance.now() - openedAt),
        source: SOURCE,
      }),
    });
    const answer: unknown = await response.json().catch(() => null);
    const message =
      typeof answer === "object" && answer !== null && typeof (answer as { message?: unknown }).message === "string"
        ? (answer as { message: string }).message
        : UNREADABLE;
    if (response.ok) {
      showStatus(status, message, "ok");
      form.reset();
    } else {
      showStatus(status, message, "error");
    }
  } catch {
    showStatus(status, OFFLINE, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

document.querySelectorAll<HTMLFormElement>("form[data-waitlist]").forEach((form) => {
  const email = form.querySelector<HTMLInputElement>("input[name=email]");
  const status = form.querySelector<HTMLElement>("[data-waitlist-status]");
  if (!email || !status) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void send(form, email, status);
  });
});
