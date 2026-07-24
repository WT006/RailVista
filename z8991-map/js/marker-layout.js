(function (global) {
  function computeMapBounds(points, paddingRatio) {
    const pad = paddingRatio ?? 0.06;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    points.forEach(({ lng, lat }) => {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
    const padLng = (maxLng - minLng) * pad || 0.5;
    const padLat = (maxLat - minLat) * pad || 0.5;
    return {
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
    };
  }

  function createProjector(bounds) {
    const width = 1000;
    const height = (1000 * (bounds.maxLat - bounds.minLat)) / (bounds.maxLng - bounds.minLng);
    return {
      width,
      height,
      bounds,
      project(lng, lat) {
        const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
        const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
        return { x, y };
      },
      unproject(x, y) {
        const lng = bounds.minLng + (x / width) * (bounds.maxLng - bounds.minLng);
        const lat = bounds.maxLat - (y / height) * (bounds.maxLat - bounds.minLat);
        return { lng, lat };
      },
    };
  }

  function layoutScenicSpots(spots, project, options) {
    const minSep = options?.minSep ?? 26;
    const passes = options?.passes ?? 12;
    const items = spots.map((spot) => {
      const { x, y } = project(spot.lng, spot.lat);
      return { spot, x, y, dx: 0, dy: 0 };
    });

    for (let pass = 0; pass < passes; pass += 1) {
      let moved = false;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const ax = a.x + a.dx;
          const ay = a.y + a.dy;
          const bx = b.x + b.dx;
          const by = b.y + b.dy;
          let dx = ax - bx;
          let dy = ay - by;
          let dist = Math.hypot(dx, dy);
          if (dist >= minSep) continue;

          if (dist < 0.001) {
            const angle = ((a.spot.id - b.spot.id) * Math.PI) / 3;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
          }

          const push = (minSep - dist) / 2 + 0.5;
          const ux = dx / dist;
          const uy = dy / dist;
          a.dx += ux * push;
          a.dy += uy * push;
          b.dx -= ux * push;
          b.dy -= uy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }

    return items.map(({ spot, x, y, dx, dy }) => ({
      spot,
      x: x + dx,
      y: y + dy,
    }));
  }

  global.Z8991_MARKER_LAYOUT = {
    computeMapBounds,
    createProjector,
    layoutScenicSpots,
  };
})(typeof window !== 'undefined' ? window : globalThis);
