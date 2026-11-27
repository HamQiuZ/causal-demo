document.documentElement.classList.add("js");
const header = document.querySelector("[data-header]");
const menuButton = document.querySelector(".menu-button");
const navLinks = document.querySelectorAll(".site-nav a");
const copyButton = document.querySelector("[data-copy-citation]");
const scrollCue = document.querySelector(".hero-scroll-cue");
const scrollCueFadeDistance = 144;
const headerScrollThreshold = 90;

const updateHeader = () => {
  header?.classList.toggle("is-scrolled", window.scrollY > headerScrollThreshold);
  if (scrollCue) {
    const progress = Math.min(1, Math.max(0, window.scrollY / scrollCueFadeDistance));
    scrollCue.style.opacity = String(1 - progress);
    scrollCue.toggleAttribute("inert", progress === 1);
  }
};

const closeMenu = () => {
  document.body.classList.remove("menu-open");
  menuButton?.setAttribute("aria-expanded", "false");
};

menuButton?.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("menu-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

navLinks.forEach((link) => link.addEventListener("click", closeMenu));
let headerFramePending = false;
window.addEventListener("scroll", () => {
  if (headerFramePending) return;
  headerFramePending = true;
  window.requestAnimationFrame(() => {
    updateHeader();
    headerFramePending = false;
  });
}, { passive: true });
window.addEventListener("resize", updateHeader);
window.addEventListener("pageshow", updateHeader);
updateHeader();

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});

if (copyButton) {
  copyButton.addEventListener("click", async () => {
    const citation = document.querySelector("#bibtex code")?.textContent?.trim();
    if (!citation) return;

    try {
      await navigator.clipboard.writeText(citation);
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1800);
    } catch {
      copyButton.textContent = "Select text";
    }
  });
}

const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 }
  );

  reveals.forEach((element) => observer.observe(element));
} else {
  reveals.forEach((element) => element.classList.add("is-visible"));
}

// Keep the reference navigation usable with keyboard and responsive resizing.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
    closeMenu();
    menuButton?.focus();
  }
});
window.matchMedia("(min-width: 681px)").addEventListener("change", closeMenu);

// The matrix filters emphasize rows while preserving every connection.
const maskFigure = document.querySelector("#attention-mask");
if (maskFigure) {
  const controls = maskFigure.querySelector(".mask-controls");
  const buttons = maskFigure.querySelectorAll("[data-mask-view]");
  const rows = maskFigure.querySelectorAll(".mask-row");
  const descriptions = {
    all: "Clean media never attends to motion prompts.",
    denoise: "Noisy media attends to the active prompt and visible clean history.",
    clean: "Clean commits attend only to shared context and clean media.",
  };
  controls.hidden = false;
  buttons.forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.maskView;
    buttons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    rows.forEach((row) => row.classList.toggle("is-muted", view !== "all" && row.dataset.maskKind !== view));
    maskFigure.querySelector("#mask-view-description").textContent = descriptions[view];
  }));
}
