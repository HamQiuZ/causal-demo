// Wind follows the rim, catches on facial features, and fans out over shadowed skin.
(() => {
  const canvas = document.querySelector(".hero-silk");
  const ctx = canvas?.getContext("2d");
  const speaker = window.HeroSpeaker;
  if (!ctx || !speaker) return;
  const title = canvas.closest(".hero")?.querySelector(".hero-title");
  const titleSuffix = title?.lastElementChild;

  const tau = 2 * Math.PI;
  const clamp = n => Math.min(1, Math.max(0, n));
  const mix = (a, b, n) => a + (b - a) * n;
  const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const approachSeconds = 5.8, edgeSeconds = 6.8, wakeSeconds = 6.4;
  const lifetime = approachSeconds + edgeSeconds + wakeSeconds;
  const stillTime = 24;

  const stops = [
    [168, 114, 63], [193, 139, 94], [188, 153, 115], [155, 154, 126],
    [115, 147, 115], [92, 144, 129], [66, 133, 137]
  ];
  function colorRamp(colors) {
    return Array.from({ length: 96 }, (_, i) => {
      const u = i / 95 * (colors.length - 1);
      const k = Math.min(colors.length - 2, Math.floor(u));
      return 'rgb(' + colors[k].map((v, c) => Math.round(mix(v, colors[k + 1][c], u - k))).join(' ') + ')';
    });
  }
  const palette = colorRamp(stops);
  const inks = {
    graphite: [[93, 83, 68], [58, 79, 77]], lash: [[143, 124, 101], [98, 118, 107]],
    iris: [[98, 111, 106], [61, 99, 109]], umber: [[148, 113, 86], [102, 115, 99]],
    rose: [[163, 103, 90], [148, 111, 100]], lipInk: [[109, 75, 65], [99, 83, 76]],
    linen: [[155, 135, 103], [121, 146, 137]], cloth: [[144, 143, 129], [108, 135, 137]]
  };
  const lineColors = Object.fromEntries(Object.entries(inks).map(([name, colors]) => [name, colorRamp(colors)]));
  function softGrain(rgb) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 32;
    const brush = tile.getContext('2d');
    const falloff = brush.createRadialGradient(16, 16, 0, 16, 16, 16);
    for (const [at, alpha] of [[0, .98], [.18, .87], [.47, .56], [.77, .18], [1, 0]]) {
      falloff.addColorStop(at, 'rgba(' + rgb.join(',') + ',' + alpha + ')');
    }
    brush.fillStyle = falloff;
    brush.fillRect(0, 0, 32, 32);
    return tile;
  }
  const washes = {
    rose: inks.rose, iris: inks.iris,
    champagne: [[229, 207, 157], [236, 220, 177]],
    celadon: [[184, 218, 210], [201, 230, 221]]
  };
  const dust = Object.fromEntries(Object.entries(washes).map(([name, tones]) => [name, tones.map(softGrain)]));
  const ribbonLight = [stops[1], stops[5]].map(softGrain);
  const airborneDust = [[stops[0], stops[1]], [stops[4], stops[6]]]
    .map(tones => tones.map(softGrain));

  let width = 0, height = 0, size = 0, flowSize = 0, center = 0, top = 0;
  let gateX = 0, gateY = 0, reach = 0, radius = 1, windRadius = 1;
  let compact, grains = [], rim, facePaths = [], planes = [];
  let titleBounds;
  let visible = true, showcaseBusy = false, frame = 0, lastPaint = null, time = reduced.matches ? stillTime : 0;

  function segmentAt(path, distance) {
    const nodes = path.nodes;
    let lo = 0, hi = nodes.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >>> 1;
      if (nodes[m].at <= distance) lo = m;
      else hi = m;
    }
    return lo;
  }

  function sourceAt(path, distance) {
    const i = segmentAt(path, distance), a = path.nodes[i], b = path.nodes[i + 1];
    const u = (distance - a.at) / (b.at - a.at);
    return { x: mix(a.point.x, b.point.x, u), y: mix(a.point.y, b.point.y, u) };
  }

  // Normalized portrait space. Keep the rounded collar legible while the
  // two sleeve ends dissolve at their different heights in the drawing.
  function garmentOpacity(x, y) {
    if (y <= .70) return 1;
    const farSleeve = smooth((-.34 - x) / .17);
    const nearSleeve = smooth((x - .015) / .15);
    const hem = smooth((y - .85 + .15 * farSleeve) / .15);
    return 1 - hem * (.38 + .60 * Math.max(farSleeve, nearSleeve));
  }

  function measurePath(points, widths) {
    const nodes = [];
    let length = 0;
    for (const point of points) {
      const prev = nodes.at(-1);
      if (prev) {
        const step = Math.hypot(point.x - prev.point.x, point.y - prev.point.y);
        if (step < 1e-7) continue;
        length += step;
      }
      nodes.push({ point, at: length, x: 0, y: 0, nx: 0, ny: 0,
        hemAlpha: garmentOpacity(point.x, point.y) });
    }
    const path = { nodes, length };
    if (!length) return path;
    for (const p of nodes) {
      // Average the grain's tiny offset over a physical length. At a hairpin
      // it contracts instead of flipping abruptly between opposite normals.
      const lo = Math.max(0, p.at - .013), hi = Math.min(length, p.at + .013);
      const a = sourceAt(path, lo), b = sourceAt(path, hi);
      p.nx = (b.y - a.y) / (hi - lo);
      p.ny = (a.x - b.x) / (hi - lo);
      p.width = 0;
      if (widths) {
        const at = p.at / length * (widths.length - 1);
        const i = Math.min(widths.length - 2, Math.floor(at));
        p.width = mix(widths[i], widths[i + 1], smooth(at - i));
      }
    }
    return path;
  }

  function prepare(small) {
    rim = measurePath(speaker.createPoints());
    const faceInk = new Set(['brow', 'eye', 'iris', 'pupil', 'lip']);
    facePaths = speaker.createFeatures().map(({ part, side, weight, ink, widths, points }) => ({
      part, side, weight, ink, colors: lineColors[ink], inkOpacity: faceInk.has(part) ? .905 : 1,
      ...measurePath(points, widths)
    })).filter(path => path.length > 0);
    if (!rim.length) { grains = []; return; }

    let state = 198577;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    function makeGrain(enter, leave, direction, birth) {
      return {
        enter, leave, direction, birth,
        channel: random() < .5 ? 0 : 1, lane: random() + random() - 1,
        eddy: random(), drift: random() + random() - 1, depth: random(),
        grain: .62 + random() * .58, fine: random() < .48
      };
    }
    const count = small ? 460 : 1080;
    // Arc-length stations on the traced silhouette: the swept hair behind
    // the ear and the outer rise of the near shoulder.
    const roots = [.354, .909];
    rim.windRoots = roots.map(at => sourceAt(rim, at * rim.length));
    grains = Array.from({ length: count }, (_, i) => {
      const mid = ((i + .5) * .61803398875 + .06 * random()) % 1;
      const direction = random() < smooth((mid - .18) / .46) ? 1 : -1;
      const span = .130 + .107 * random();
      const low = Math.max(0, Math.min(1 - span, mid - .5 * span));
      const enter = direction > 0 ? low : low + span;
      const grain = makeGrain(enter, enter + direction * span, direction, (i + .5) * lifetime / count - approachSeconds);
      const heightAtContact = sourceAt(rim, enter * rim.length).y;
      const lowerCurrent = smooth((heightAtContact - .50) / .40);
      grain.channel = grain.eddy < .10 + .80 * lowerCurrent ? 1 : 0;
      return grain;
    });
    // These grains stay with one strand from the open current through the
    // bend in the silhouette. Reuse part of the seeded field so the facial
    // paths retain their original phase and sampling.
    const strandCount = Math.round(count * .36);
    for (let i = 0; i < strandCount; i++) {
      const seed = grains[(37 * i + 13) % count];
      const channel = i % 2;
      const enter = roots[channel] + seed.lane * (channel ? .030 : .052);
      const span = channel ? .043 + .017 * seed.eddy : .081 + .026 * seed.eddy;
      const leave = enter + span;
      const birth = (i + .25 + .5 * seed.depth) * lifetime / strandCount - approachSeconds;
      grains.push({ ...seed, enter, leave, direction: 1, channel, birth, bridge: true });
    }

    // Feed each separate stroke at regular intervals, proportional to its arc
    // length. Even a small nostril keeps its shape between passing gusts.
    const gates = Array.from({ length: 160 }, (_, i) => {
      const at = (i + .5) / 160;
      return { at, ...sourceAt(rim, at * rim.length) };
    });
    for (const path of facePaths) {
      const first = path.nodes[0].point;
      const nearby = gates.filter(g => g.x > first.x + .008 && Math.abs(g.y - first.y) < .085);
      const pool = nearby.length ? nearby : gates;
      const gather = 2.35 + .35 * random(), slide = edgeSeconds - gather;
      const density = Math.sqrt(path.weight) * (path.ink === 'graphite' ? 1.90 : 1);
      const residents = Math.max(2, path.length * (small ? 128 : 208) * density);
      const total = Math.ceil(residents * lifetime / slide);
      const phase = .12 + .76 * random();
      for (let i = 0; i < total; i++) {
        const departure = pool[Math.floor(random() * pool.length)].at;
        const direction = random() < .5 ? -1 : 1;
        const speed = direction * (.019 + .012 * random());
        const alongRim = .67 + .41 * random();
        const enter = clamp(departure - alongRim * speed);
        const leave = clamp(enter + edgeSeconds * speed);
        const birth = (i + phase + .15 * (random() - .5)) * lifetime / total - approachSeconds;
        const grain = makeGrain(enter, leave, direction, birth);
        grain.branch = {
          path, departure: mix(enter, leave, alongRim / edgeSeconds), alongRim,
          crossing: gather - alongRim, slide
        };
        grains.push(grain);
      }
    }
    planes = speaker.createPlanes().map(plane => preparePlane(plane, small, random));
  }

  // Allocate grains by the area between adjacent cross sections. A wide
  // shadow gets an even wash; its pointed ends don't build up clumps.
  function preparePlane(plane, small, random) {
    let area = 0;
    const nodes = plane.left.map((a, i) => {
      const b = plane.right[i];
      if (i) {
        const prevA = plane.left[i - 1], prevB = plane.right[i - 1];
        area += .5 * Math.abs((b.x - prevA.x) * (a.y - prevB.y) - (b.y - prevA.y) * (a.x - prevB.x));
      }
      const hemAlpha = garmentOpacity((a.x + b.x) / 2, (a.y + b.y) / 2);
      return { a, b, at: area, x: 0, y: 0, dx: 0, dy: 0, hemAlpha };
    });
    // Keep broad, low-opacity washes legible when the whole head is thumbnail-sized.
    const mobileDensity = plane.form ? 23500 : 17700;
    const count = Math.max(10, Math.round(area * (small ? mobileDensity : 45000) / plane.grainScale ** 2));
    const grains = Array.from({ length: count }, (_, i) => ({
      start: (i + .20 + .60 * random()) / count, lane: (i * .618034 + random() * .066) % 1,
      phase: random() * tau, size: plane.grainScale * (.69 + .64 * random()), birth: random(),
      tile: dust[plane.ink][random() < .54 ? 0 : 1]
    }));
    const speed = .053 + .021 * random();
    return { ...plane, nodes, area, grains, speed: plane.form ? speed * .30 : speed };
  }

  function paintPlane(plane, motion) {
    for (const node of plane.nodes) {
      const a = speaker.sample(node.a, motion);
      node.x = center + size * a.x;
      node.y = top + size * a.y;
      if (plane.cast) {
        node.dx = size * (node.b.x - node.a.x);
        node.dy = size * (node.b.y - node.a.y);
      } else {
        const b = speaker.sample(node.b, motion);
        node.dx = size * (b.x - a.x);
        node.dy = size * (b.y - a.y);
      }
    }
    if (plane.cast) {
      // Clip to the receiving side of the edge so the penumbra cannot spill
      // back onto the brightly lit cheek, even on a small canvas.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(plane.nodes[0].x, plane.nodes[0].y);
      for (const n of plane.nodes) ctx.lineTo(n.x, n.y);
      for (let i = plane.nodes.length - 1; i >= 0; i--) {
        const n = plane.nodes[i];
        ctx.lineTo(n.x + n.dx, n.y + n.dy);
      }
      ctx.closePath();
      ctx.clip();
    }
    const lights = plane.highlights.map(h => {
      const p = speaker.sample(h.point, motion);
      return { x: center + size * p.x, y: top + size * p.y, r: size * h.radius };
    });
    const strength = plane.strength * (lights.length ? 1 - .92 * motion.blink : 1);
    for (const grain of plane.grains) {
      const buildup = smooth((time - 1.8 - 4.7 * grain.birth) / 3);
      if (!buildup) continue;
      const u = (grain.start + time * plane.speed) % 1;
      const v = grain.lane + .048 * Math.sin(grain.phase + time * .47) * Math.sin(Math.PI * grain.lane);
      const mass = plane.area * u, index = segmentAt(plane, mass);
      const a = plane.nodes[index], b = plane.nodes[index + 1];
      const t = (mass - a.at) / (b.at - a.at);
      const dx = mix(a.dx, b.dx, t), dy = mix(a.dy, b.dy, t);
      const x = mix(a.x, b.x, t) + v * dx, y = mix(a.y, b.y, t) + v * dy;
      const ends = smooth(Math.min(u, 1 - u) / .085);
      let coverage;
      if (plane.cast) {
        coverage = 1 - smooth(v);
      } else if (plane.form) {
        // A turning surface has a soft terminator on both sides. The peak
        // sits toward the side facing away from the upper-left light.
        const edge = v < plane.core ? v / plane.core : (1 - v) / (1 - plane.core);
        coverage = smooth(edge);
      } else {
        coverage = (1 - .78 * smooth(Math.abs(v - plane.core))) * (.26 + .74 * smooth(Math.min(v, 1 - v) / .23));
      }
      const alpha = .56 * strength * buildup * ends * coverage * mix(a.hemAlpha, b.hemAlpha, t);
      if (alpha < .009) continue;
      let r = Math.min(size * .0091 * grain.size, .55 * Math.hypot(dx, dy) + radius * .4);
      for (const h of lights) r = Math.min(r, Math.hypot(x - h.x, y - h.y) - h.r * .78);
      if (r <= .12) continue;
      ctx.globalAlpha = alpha;
      ctx.drawImage(grain.tile, x - r, y - r, r * 2, r * 2);
    }
    if (plane.cast) ctx.restore();
  }

  function poseRim(motion) {
    for (const path of [rim, ...facePaths]) {
      for (const r of path.nodes) {
        const p = speaker.sample(r.point, motion);
        r.x = center + p.x * size;
        r.y = top + p.y * size;
      }
    }
  }

  // Sample both position and its derivative on the same, slightly offset
  // polyline. This makes the flight tangent match the actual travel at contact.
  function surface(position, grain, path = rim, speed = (grain.leave - grain.enter) / edgeSeconds) {
    const d = clamp(position) * path.length;
    const lo = segmentAt(path, d);
    const a = path.nodes[lo], b = path.nodes[lo + 1], gap = b.at - a.at;
    const u = (d - a.at) / gap;
    const skin = radius * (.12 + .78 * grain.depth + (grain.fine ? .43 : 0)) * (path === rim ? 1 : .24);
    const lane = .5 * size * grain.lane;
    const offsetA = skin + lane * a.width, offsetB = skin + lane * b.width;
    const ax = a.x + offsetA * a.nx, ay = a.y + offsetA * a.ny;
    const dx = b.x + offsetB * b.nx - ax, dy = b.y + offsetB * b.ny - ay;
    const rate = speed * path.length / gap;
    const width = size * mix(a.width, b.width, u);
    return { x: ax + u * dx, y: ay + u * dy, vx: dx * rate, vy: dy * rate,
      width, hemAlpha: mix(a.hemAlpha, b.hemAlpha, u) };
  }

  function facePass(grain, elapsed) {
    const { path, departure, crossing, slide } = grain.branch;
    const position = clamp((elapsed - crossing) / slide);
    const target = surface(position, grain, path, 1 / slide);
    const end = Math.min(position, 1 - position);
    const endFade = .68 + .32 * smooth(end / .085);
    const feather = path.side === 'left' ? 1 - .62 * smooth((position - .58) / .42) : 1;
    const pressure = path.colors ? .70 + .30 * smooth(target.width / (1.65 * radius)) : 1;
    const ink = .86 * path.weight * endFade * feather * pressure * path.inkOpacity;
    if (elapsed >= crossing) {
      const nib = path.colors ? .67 + .62 * smooth(target.width / (2.4 * radius)) : 1;
      return { ...target, detail: 1, ink, nib };
    }

    // A Hermite curve carries the actual incoming and outgoing velocities.
    // The few grains in the air between hair and skin remain especially faint.
    const from = surface(departure, grain);
    const u = elapsed / crossing, v = 1 - u, blend = smooth(u);
    const a = crossing * u * v * v, b = -crossing * v * u * u;
    const slope = 6 * u * v / crossing, da = v * (1 - 3 * u), db = u * (3 * u - 2);
    const x = mix(from.x, target.x, blend) + a * from.vx + b * target.vx;
    const y = mix(from.y, target.y, blend) + a * from.vy + b * target.vy;
    const gap2 = (x - target.x) ** 2 + (y - target.y) ** 2;
    const settle = Math.exp(-gap2 / (2 * (2.4 * radius) ** 2));
    const airborne = mix(.115, .018, smooth(u / .22));
    return {
      x, y,
      vx: slope * (target.x - from.x) + da * from.vx + db * target.vx,
      vy: slope * (target.y - from.y) + da * from.vy + db * target.vy,
      detail: blend, ink: mix(airborne, ink, blend * settle), hemAlpha: mix(from.hemAlpha, target.hemAlpha, blend)
    };
  }

  function windRootX(channel) {
    return center + size * rim.windRoots[channel].x;
  }

  function farWaveOpacity(x, channel) {
    const root = windRootX(channel);
    const along = (x - root) / Math.max(1, width - root);
    // The remote crest softens first, with a longer, gentler tail to the viewport edge.
    const t = clamp((along - .45) / .55);
    return 1 - .12 * smooth(t * (2 - t));
  }

  function windY(x, channel, lane, eddy, clock) {
    const rootX = windRootX(channel);
    const r = clamp((x - rootX) / (width + radius * 18 - rootX));
    const rootY = top + size * rim.windRoots[channel].y;
    const centerY = mix(rootY, gateY, smooth(r / .75));
    const bow = Math.sin(Math.PI * r);
    const bend = bow * (-.052 + .040 * Math.sin(3.8 * r + clock * .23));
    const split = smooth(r / .32) * (.052 + .175 * r) *
      Math.sin(Math.PI * (1.43 * r - .17) + .21 * Math.sin(clock * .19));
    const roll = Math.cos(5.4 * r + clock * .21 + channel * 1.7);
    const widthY = .016 + .063 * r + .026 * bow;
    const fiber = lane * (.64 + .36 * roll + .15 * Math.sin(5 * r + lane * 2 + clock * .17));
    return centerY + flowSize * (bend + (channel ? -split : split) + widthY * fiber +
      (.004 + .009 * r) * (eddy - .5) * Math.sin(14 * r + clock * .33));
  }

  function reflectedLight(clock) {
    const buildup = .20 + .80 * smooth(clock / 6);
    const far = width + radius * 18;
    for (let channel = 0; channel < 2; channel++) {
      const root = windRootX(channel);
      const steps = Math.max(16, Math.ceil((far - root) / (compact ? 3.3 : 6.2)));
      const pitch = (far - root) / steps;
      for (let j = 0; j <= steps; j++) {
        const u = j / steps, x = mix(root, far, u);
        const join = smooth((x - root) / (size * .15));
        if (!join) continue;
        const y = windY(x, channel, 0, .5, clock);
        const pulse = .5 + .5 * Math.cos(tau * (1.45 * u + .056 * clock + channel * .37));
        const fan = .5 + .5 * Math.sin(tau * (1.12 * u + .039 * clock + .41 * channel));
        const light = buildup * join * (.76 + .24 * pulse) * farWaveOpacity(x, channel);
        const spread = flowSize * (.025 + .020 * smooth(u / .4) + .015 * Math.sin(Math.PI * u)) *
          (.73 + .46 * fan);
        // Each soft dab overlaps its neighbours in proportion to the sampling
        // pitch, so the luminous body has the same density on a phone.
        ctx.globalAlpha = .070 * light;
        ctx.drawImage(ribbonLight[channel], x - 2 * pitch, y - spread, 4 * pitch, 2 * spread);
        // A thinner, off-centre current alternately catches and loses the light.
        const threadY = windY(x, channel, channel ? -.29 : .26, .5, clock);
        const threadWidth = flowSize * (.009 + .005 * pulse);
        ctx.globalAlpha = (.014 + .043 * pulse * pulse) * light;
        ctx.drawImage(ribbonLight[channel], x - 1.8 * pitch, threadY - threadWidth, 3.6 * pitch, 2 * threadWidth);
      }
    }
  }

  function incomingPoint(grain, edge, u, clock) {
    const remaining = 1 - u;
    const braking = .28, cruise = 1 / (1 - braking / 2);
    const distance = remaining > braking ? 1 - cruise * u : cruise * remaining ** 2 / (2 * braking);
    const airX = edge.x + (width + radius * 18 - edge.x) * distance;
    const turnStart = grain.bridge ? .56 : .43;
    const turn = smooth((u - turnStart) / (1 - turnStart));
    const tangentTime = (u - 1) * approachSeconds * smooth((u - .48) / .52);
    const x = airX + size * (.032 + .019 * grain.depth) * Math.sin(Math.PI * turn) + edge.vx * tangentTime;
    const y = mix(windY(airX, grain.channel, grain.lane, grain.eddy, clock), edge.y, turn) + edge.vy * tangentTime;
    return { x, y, airX };
  }

  function reflectedPoint(grain, edge, u, clock) {
    // Leave with the real rim tangent, then join the same moving current.
    const tangentTime = (1 - u) ** 2 * u * wakeSeconds;
    const along = smooth(u);
    const openWidth = width + radius * 18 - edge.x;
    const x = edge.x + tangentTime * edge.vx + openWidth * (.54 + .27 * grain.depth) * along;
    const currentY = windY(x, grain.channel, grain.lane, grain.eddy, clock);
    return { x, y: mix(edge.y, currentY, along) + tangentTime * edge.vy };
  }

  function flight(grain, age, clock) {
    const travel = clamp((age - approachSeconds) / edgeSeconds);
    const position = mix(grain.enter, grain.leave, travel);
    const elapsed = age - approachSeconds;
    const edge = grain.branch && elapsed > grain.branch.alongRim
      ? facePass(grain, elapsed - grain.branch.alongRim) : surface(position, grain);
    let x = edge.x, y = edge.y, contact = 1, opacity = .86, decay = 1, flowAngle;
    if (age < approachSeconds) {
      const u = age / approachSeconds;
      const point = incomingPoint(grain, edge, u, clock);
      x = point.x; y = point.y;
      if (grain.bridge) {
        const dt = Math.min(.02, approachSeconds - age);
        const next = incomingPoint(grain, edge, u + dt / approachSeconds, clock + dt);
        flowAngle = Math.atan2(next.y - y, next.x - x);
      }
      contact = smooth((u - .80) / .20);
      // Lift the two incoming colors only in the open stream.
      const air = smooth((point.airX - gateX) / (width - gateX));
      opacity = (.39 + .47 * contact + .086 * air) * smooth(u / .065);
    } else if (age > approachSeconds + edgeSeconds) {
      const u = (age - approachSeconds - edgeSeconds) / wakeSeconds;
      const one = 1 - u;
      // Cubic Bézier with the exact outgoing velocity as its first handle.
      // Gravity-free advection gradually takes over from the local tangent.
      if (grain.bridge && grain.eddy < .62) {
        const point = reflectedPoint(grain, edge, u, clock);
        x = point.x; y = point.y;
        const dt = Math.min(.02, lifetime - age);
        const next = reflectedPoint(grain, edge, u + dt / wakeSeconds, clock + dt);
        flowAngle = Math.atan2(next.y - y, next.x - x);
      } else {
        const far = reach * (.75 + .32 * grain.depth);
        const tangentTime = one * one * u * wakeSeconds;
        const spread = grain.drift + .19 * Math.sin(clock * .25 + 5 * grain.eddy);
        const lift = .055 * grain.direction + .06 * Math.sin(clock * .29 + position * 7);
        x += tangentTime * edge.vx - far * (1.10 * one * u * u + u ** 3);
        y += tangentTime * edge.vy +
          size * (3 * one * u * u * (lift + .14 * spread) + u ** 3 * (2 * lift + .76 * spread));
      }
      contact = 1 - smooth(u / .31);
      decay = 1 - smooth(u);
      opacity = .86 * (1 - .57 * smooth(u / .41)) * decay;
    }
    return { x, y, contact, opacity, decay, position, edge, flowAngle };
  }

  function draw(grain, clock) {
    if (clock < grain.birth) return;
    const age = (clock - grain.birth) % lifetime;
    const { x, y, contact, opacity, decay, position, edge, flowAngle } = flight(grain, age, clock);
    // Coherent highlights travel along the rim with the air. There is no
    // permanent paint under them; several small stretches can lighten at once.
    const glow = .5 + .5 * Math.cos(tau * (position * 2.34 - grain.direction * clock * .071));
    const crest = smooth((glow - .29) / .67);
    const light = .5 + .5 * Math.sin(tau * (x / size * .62 - y / size * .31 + clock / 13.5));
    const detail = edge.detail || 0;
    const fiberHue = grain.channel ? .67 + .31 * grain.eddy : .018 + .22 * grain.eddy;
    const baseHue = mix(fiberHue, light, .04 + .46 * contact);
    const path = grain.branch?.path, part = path?.part;
    const tint = part === 'lip' ? .12 : part === 'eye' || part === 'iris' || part === 'pupil' || part === 'brow' ? .84 : baseHue;
    const hue = mix(baseHue, tint, .27 * detail * contact);
    const highlight = mix(.28 + .78 * crest, .81 + .19 * crest, detail);
    // A short fade at release leaves the space beyond each facial stroke open.
    let ink = grain.branch ? (edge.ink ?? .115) * (.12 + .88 * contact) : 1;
    const sinceExit = age - approachSeconds - edgeSeconds;
    if (grain.branch && sinceExit > 0) {
      const gap2 = (x - edge.x) ** 2 + (y - edge.y) ** 2;
      const linger = (1 - smooth(sinceExit / .48)) * Math.exp(-gap2 / (8 * radius * radius));
      ink *= .035 + .965 * linger;
    }
    const air = grain.branch ? 0 : (1 - contact) * smooth((x - edge.x) / Math.max(1, width - edge.x));
    let alpha = opacity * (.73 + .27 * grain.depth) * mix(.91, highlight, contact) *
      (grain.fine ? .70 : 1) * ink * mix(1, edge.hemAlpha ?? 1, contact) * (1 + .24 * air);
    if (titleBounds && sinceExit > 0 && x < edge.x && x < titleBounds.right + 18) {
      const gap = Math.max(x - titleBounds.right, titleBounds.top - y, y - titleBounds.bottom);
      alpha *= smooth(gap / 18);
    }
    if (alpha < .009) return;
    if (!grain.branch && contact < 1 && x > gateX) alpha *= farWaveOpacity(x, grain.channel);
    const r = mix(windRadius, radius, contact) * grain.grain * (.78 + .22 * contact) * (.55 + .45 * decay) *
      (grain.fine ? .60 : 1) * (1 - .13 * detail) * (1 + .22 * air);
    const defocus = air * smooth((grain.depth - .22) / .78);
    if (defocus > .025) {
      const spread = r * (1.45 + 1.4 * defocus);
      ctx.globalAlpha = Math.min(1, alpha * .85 * defocus);
      ctx.drawImage(airborneDust[grain.channel][grain.eddy < .48 ? 0 : 1], x - spread, y - spread, 2 * spread, 2 * spread);
    }
    ctx.fillStyle = (path?.colors || palette)[Math.round(hue * 95)];
    ctx.globalAlpha = Math.min(1, alpha * (1 - .82 * defocus));
    ctx.beginPath();
    if (contact > .015 || flowAngle !== undefined) {
      const stretch = (.82 + .30 * crest) * contact + (flowAngle === undefined ? 0 : .49 * (1 - contact));
      ctx.ellipse(x, y, r * (1 + stretch), r * (1 - .34 * contact) * (edge.nib ?? 1),
        flowAngle ?? Math.atan2(edge.vy, edge.vx), 0, tau);
    } else {
      ctx.arc(x, y, r, 0, tau);
    }
    ctx.fill();
  }

  function paint() {
    if (!width || !height || !rim?.length) return;
    ctx.clearRect(0, 0, width, height);
    const motion = speaker.pose(reduced.matches ? 0 : time);
    poseRim(motion);
    reflectedLight(time);
    for (const plane of planes) paintPlane(plane, motion);
    for (const grain of grains) draw(grain, time);
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    if (reduced.matches) { preferencesChanged(); return; }
    if (lastPaint === null) lastPaint = now;
    if (now - lastPaint >= 1000 / 30 - .5) {
      time += (now - lastPaint) / 1000;
      lastPaint = now;
      paint();
    }
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    const playing = width && height && visible && !document.hidden && !reduced.matches && !showcaseBusy;
    if (playing && !frame) frame = requestAnimationFrame(tick);
    if (!playing && frame) {
      cancelAnimationFrame(frame);
      frame = 0; lastPaint = null;
    }
  }

  // Only the departing wake crosses the title. Keep its fade aligned with
  // the actual italic suffix after wrapping or a web font swap.
  function measureTitle() {
    titleBounds = null;
    if (compact || !titleSuffix) return;
    const ink = titleSuffix.getBoundingClientRect(), frame = canvas.getBoundingClientRect();
    titleBounds = { right: ink.right - frame.left + 8,
      top: ink.top - frame.top - 6, bottom: ink.bottom - frame.top + 6 };
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (width && height) {
      const small = matchMedia("(max-width: 720px)").matches;
      if (small !== compact) { compact = small; prepare(small); }
      const dpr = Math.min(window.devicePixelRatio || 1, 2, 2400 / width);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      flowSize = compact ? Math.min(height * .93, width * .40) : Math.min(350, width * .26, height * .69);
      size = flowSize * (compact ? .92 : .87);
      // The far sleeve needs extra room beside the subtitle on tablet layouts.
      const sleeveClearance = .36 * Math.max(0, 1024 - width);
      // The face sits left of the silhouette's origin in the traced portrait.
      center = compact ? width * .50 + size * .195 : width * .50 + Math.min(width * .195, 365) + sleeveClearance;
      top = compact ? (height - size) * .44 : height * .50 - size * .54;
      gateX = center + size * .19;
      gateY = top + size * .45;
      reach = compact ? Math.min(width * .64, flowSize * 2.25) : Math.min(width * .43, flowSize * 1.80);
      radius = compact ? Math.max(.61, size * .0057) : Math.max(.85, size * .00365);
      windRadius = compact ? Math.max(.61, flowSize * .0057) : Math.max(.85, flowSize * .00365);
      measureTitle();
      paint();
    }
    sync();
  }

  resize();
  document.fonts?.ready.then(() => { measureTitle(); if (reduced.matches) paint(); });
  title?.addEventListener("animationend", measureTitle);
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }).observe(canvas);
  }
  function preferencesChanged() {
    if (reduced.matches) { time = Math.max(time, stillTime); paint(); }
    sync();
  }
  reduced.addEventListener("change", preferencesChanged);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("showcase-activity", event => { showcaseBusy = event.detail; sync(); });
})();

(() => {
  const video = document.querySelector(".hero-background-video");
  if (!video) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true, showcaseBusy = false;
  function syncVideo() {
    if (reduced.matches) {
      video.pause();
      if (video.hasAttribute("src")) { video.removeAttribute("src"); video.load(); }
    } else if (visible && !document.hidden && !showcaseBusy) {
      if (!video.hasAttribute("src")) video.src = video.dataset.src;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncVideo(); }).observe(video.closest(".hero"));
  }
  reduced.addEventListener("change", syncVideo);
  document.addEventListener("visibilitychange", syncVideo);
  window.addEventListener("showcase-activity", event => { showcaseBusy = event.detail; syncVideo(); });
  syncVideo();
})();
