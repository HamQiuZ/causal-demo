// Summary band: four claims. The pale-green arrow is scrubbed by scroll: its position is a function of how far the band has travelled up the viewport, so scrolling back moves it back.
(() => {
  const icons = {
    motion: '<svg viewBox="0 0 40 32" aria-hidden="true"><circle cx="8" cy="6.5" r="3" fill="currentColor"/><path d="M8 10.5v8M8 13l-5-4.5M8 13l3.5 4M8 18.5l-3 6M8 18.5l3 6"/><path d="M16 15.5h7M20.5 12.5l3 3-3 3"/><circle cx="32" cy="6.5" r="3" fill="currentColor"/><path d="M32 10.5v8M32 13l5-4.5M32 13l-3.5 4M32 18.5l-3 6M32 18.5l3 6"/></svg>',
    modes: '<svg viewBox="0 0 40 32" aria-hidden="true"><g transform="translate(5.6 3)"><polygon points="15.70,9.50 13.10,14.00 7.90,14.00 5.30,9.50 7.90,5.00 13.10,5.00"/><polygon points="23.50,14.00 20.90,18.51 15.70,18.51 13.10,14.00 15.70,9.50 20.90,9.50"/><polygon points="15.70,18.51 13.10,23.01 7.90,23.01 5.30,18.51 7.90,14.00 13.10,14.00"/></g></svg>',
    clock: '<svg viewBox="0 0 40 32" aria-hidden="true"><circle cx="20" cy="18" r="9.5"/><path d="M9 6.5l4 3M31 6.5l-4 3M20 18v-5M20 18l3.5 2.5M14.5 27.5l-2 2.5M25.5 27.5l2 2.5"/></svg>',
    tv: '<svg viewBox="0 0 40 32" aria-hidden="true"><rect x="6" y="9" width="28" height="18" rx="3"/><path d="M16 9l-4-5M24 9l4-5M16.5 15v6l5-3z"/><path d="M14 30h12"/></svg>',
  };
  const steps = [
    ["motion", "New instructions,", "right on cue.", "#section-pane-action-1"],
    ["modes", "Three modes.", "One framework.", "#section-pane-compare-one-reference"],
    ["clock", "Long horizon.", "Minutes to hours.", "#longform"],
    ["tv", "Real-time streaming.", "Four steps. Every chunk.", "#method-details-container"],
  ];
  const band = document.createElement("nav");
  band.className = "sum";
  band.setAttribute("aria-label", "What SekoTalk-H3 does");
  band.innerHTML = `<i class="sum-arrow" aria-hidden="true"></i><ol>${steps.map(([k, a, b, h]) =>
    `<li><a href="${h}"><span class="sum-ico">${icons[k]}</span><span class="sum-txt"><strong>${a}</strong><small>${b}</small></span></a></li>`).join("")}</ol>`;
  const arrow = band.firstElementChild, items = [...band.querySelectorAll("li")];
  // p = 0 when the band's top meets the bottom of the viewport; p = 1 when it has risen 80% of the viewport height.
  // The arrow chases that scroll target on a damped spring, so wheel steps turn into smooth acceleration and easing out.
  const presets = { stiffness: 70, damping: .9 }; // damping ratio: 1 = no overshoot, lower = a little settle-back
  let x = null, v = 0, last = 0, frame = 0;
  const target = () => {
    const r = band.getBoundingClientRect(), aw = arrow.offsetWidth;
    const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.8)));
    return -aw + p * (innerWidth + aw);
  };
  const paint = () => {
    arrow.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    const tip = x + arrow.offsetWidth;
    items.forEach(li => li.classList.toggle("on", tip > li.getBoundingClientRect().left + 24));
  };
  const step = now => {
    const dt = Math.min(.032, (now - last) / 1000 || .016); last = now;
    const k = presets.stiffness, c = 2 * Math.sqrt(k) * presets.damping, t = target();
    v += (k * (t - x) - c * v) * dt; x += v * dt;
    if (Math.abs(t - x) < .4 && Math.abs(v) < 4) { x = t; v = 0; frame = 0; paint(); return; }
    paint(); frame = requestAnimationFrame(step);
  };
  const schedule = () => {
    if (x === null) { x = target(); paint(); return; }
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(step); }
  };
  const update = schedule;
  const place = pos => { const s = document.getElementById("hero-showcase"); pos === "above" ? s.prepend(band) : s.append(band); schedule(); };
  let armed = false;
  const arm = () => { if (armed) return; armed = true; addEventListener("scroll", schedule, { passive: true }); addEventListener("resize", schedule);
    // Layout above the band (carousel, lazy media) can move it without a scroll event: re-seat the arrow without animating.
    new ResizeObserver(() => { if (x !== null && !frame) { x = target(); v = 0; paint(); } }).observe(document.body); update(); };
  place("below");
  arm();
})();
