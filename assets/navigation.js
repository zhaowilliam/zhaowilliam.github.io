(() => {
  "use strict";

  const button = document.querySelector(".nav-toggle");
  if (!button) return;

  const header = button.closest(".site-header");
  const nav = document.getElementById(button.getAttribute("aria-controls"));
  if (!header || !nav) return;

  const close = (restoreFocus = false) => {
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };

  button.addEventListener("click", () => {
    const isOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isOpen));
  });

  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });

  document.addEventListener("click", (event) => {
    if (!header.contains(event.target)) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
      close(true);
    }
  });
})();
