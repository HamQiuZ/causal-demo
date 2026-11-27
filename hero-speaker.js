// The open path follows the right-hand boundary of the reference image, from
// the crown to the cropped sleeve. Neutral coordinates preserve its aspect ratio.
(() => {
  const contours = window.HeroPortraitContours;
  if (!contours?.length) return;
  const outline = contours.filter(contour => contour.role === 'outline');
  const vertices = outline.flatMap(contour => contour.points);
  const xs = vertices.map(p => p[0]), ys = vertices.map(p => p[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const top = Math.min(...ys), height = Math.max(...ys) - top;
  // An overhead light sits to the viewer's left. Its shadow travels 24°
  // to the right of vertical, in screen space, independently of head motion.
  const lightAngle = 24 * Math.PI / 180;
  const shadowX = Math.sin(lightAngle), shadowY = Math.cos(lightAngle);
  const smooth = value => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
  };

  function placeStroke({ points, part, side, lowerLip }, stroke) {
    return points.map(([sx, sy], i) => {
      const x = (sx - centerX) / height, y = (sy - top) / height;
      const before = points[Math.max(0, i - 1)], after = points[Math.min(i + 1, points.length - 1)];
      const dx = after[0] - before[0], dy = after[1] - before[1];
      const length = Math.hypot(dx, dy) || 1;
      // Weight by position so adjoining hair, neck and shoulder pieces always meet.
      const head = smooth((.76 - y) / .16);
      const tips = Math.exp(-(((y - .55) / .11) ** 2)) * smooth((x + .02) / .12);
      const lid = part === 'eye' || part === 'iris' || part === 'pupil';
      // Perspective gives the two eye openings different axes.
      const closedY = side === 'left'
        ? 512 - .119 * (sx - 344) + 2 * Math.sin(Math.PI * (sx - 344) / 93)
        : 476 - .433 * (sx - 523) + 3 * Math.sin(Math.PI * (sx - 523) / 98);
      const blink = lid ? (closedY - sy) / height : 0;
      const lip = lowerLip ? smooth((548 - sx) / 48) : 0;
      return { x, y, nx: dy / length, ny: -dx / length, stroke, head, tips, blink, lip };
    });
  }

  function createPoints() {
    return outline.flatMap(placeStroke);
  }

  function createFeatures() {
    return contours.filter(contour => contour.role === 'detail').map((contour, i) => ({
      part: contour.part, side: contour.side, weight: contour.weight,
      ink: contour.ink, widths: contour.widths?.map(w => w / height), points: placeStroke(contour, i)
    }));
  }

  function createPlanes() {
    return contours.filter(c => c.role === 'plane' || c.role === 'cast' || c.role === 'form').map(plane => {
      const part = plane.part === 'nearIris' ? 'iris' : plane.part;
      const place = points => placeStroke({ points, part, lowerLip: plane.lowerLip }, 0);
      if (plane.role === 'cast') {
        const left = place(plane.ridge);
        const right = left.map((p, i) => {
          const reach = plane.ridge[i][2] / height;
          return { ...p, x: p.x + reach * shadowX, y: p.y + reach * shadowY };
        });
        return { ink: plane.ink, strength: plane.strength, cast: true,
          grainScale: .53, left, right, highlights: [] };
      }
      const left = place(plane.sections.map(([x, y]) => [x, y]));
      const right = place(plane.sections.map(row => row.slice(2)));
      const highlights = (plane.highlights || []).map(([x, y, r]) => ({
        point: place([[x, y]])[0], radius: r / height
      }));
      const form = plane.role === 'form';
      return { ink: plane.ink, strength: plane.strength, core: plane.core, form,
        grainScale: form ? 1.55 : (plane.grainScale || 1), left, right, highlights };
    });
  }

  function pose(time) {
    const a = time % 8 * Math.PI / 4;
    return {
      nod: .0042 * Math.sin(a) + .0014 * Math.sin(2 * a),
      breath: .0016 * Math.sin(a),
      curl: .0028 * Math.sin(2 * a) - .0009 * Math.sin(3 * a),
      blink: ((1 - Math.cos(a)) * .5) ** 170,
      lip: .004 * Math.sin(6 * a + .65 * Math.sin(3 * a)) ** 2 * (.6 + .4 * Math.cos(a))
    };
  }

  function sample(p, motion) {
    const angle = p.head * motion.nod, c = Math.cos(angle), s = Math.sin(angle);
    const dx = p.x + .07, dy = p.y - .70 + p.blink * motion.blink + p.lip * motion.lip;
    return {
      x: -.07 + c * dx - s * dy + motion.curl * p.tips,
      y: .70 + s * dx + c * dy + motion.breath * (1 - p.y),
      nx: c * p.nx - s * p.ny, ny: s * p.nx + c * p.ny
    };
  }

  window.HeroSpeaker = { createPoints, createFeatures, createPlanes, pose, sample };
})();
