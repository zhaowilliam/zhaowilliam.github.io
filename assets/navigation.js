(() => {
  "use strict";

  const button = document.querySelector(".nav-toggle");
  if (!button) return;

  const header = button.closest(".site-header");
  const nav = document.getElementById(button.getAttribute("aria-controls"));
  if (!header || !nav) return;

  const sections = [...nav.querySelectorAll('a[href^="#"]')]
    .map((link) => ({ link, section: document.getElementById(link.hash.slice(1)) }))
    .filter(({ section }) => section);

  let updateQueued = false;
  let currentLink = null;
  const updateCurrentSection = () => {
    if (!sections.length || updateQueued) return;

    updateQueued = true;
    window.requestAnimationFrame(() => {
      updateQueued = false;
      const marker = window.scrollY + header.offsetHeight + Math.min(window.innerHeight * 0.25, 180);
      let current = null;

      sections.forEach(({ link, section }) => {
        link.removeAttribute("aria-current");
        if (section.offsetTop <= marker) current = link;
      });

      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = sections[sections.length - 1].link;
      }

      if (current) {
        current.setAttribute("aria-current", "location");

        if (current !== currentLink && nav.scrollWidth > nav.clientWidth) {
          const navRect = nav.getBoundingClientRect();
          const linkRect = current.getBoundingClientRect();
          nav.scrollBy({
            left: linkRect.left - navRect.left - (navRect.width - linkRect.width) / 2,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          });
        }
      }

      currentLink = current;
    });
  };

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

  window.addEventListener("scroll", updateCurrentSection, { passive: true });
  window.addEventListener("resize", updateCurrentSection);
  updateCurrentSection();
})();
