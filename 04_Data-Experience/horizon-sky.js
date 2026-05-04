/*!
 * Atmospheric sky gradient derived from Horizon by Daniel Lazaro:
 * https://github.com/dnlzro/horizon (MIT License)
 *
 * Physical model / technique: Sébastien Hillaire; implementation lineage via
 * Andrew Helmer "Production Sky Rendering" (MIT), Shadertoy slSXRW.
 *
 * Solar position via a subset of SunCalc by Vladimir Agafonkin:
 * https://github.com/mourner/suncalc (BSD 2-Clause License)
 */

(function (global) {
  "use strict";

  // ----- SunCalc subset: sun position (altitude/azimuth in radians) -----
  const PI = Math.PI,
    sin = Math.sin,
    cos = Math.cos,
    tan = Math.tan,
    asin = Math.asin,
    atan = Math.atan2,
    rad = PI / 180;

  const dayMs = 1000 * 60 * 60 * 24,
    J1970 = 2440588,
    J2000 = 2451545;

  function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
  }
  function toDays(date) {
    return toJulian(date) - J2000;
  }

  const e = rad * 23.4397;

  function rightAscension(l, b) {
    return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
  }
  function declination(l, b) {
    return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
  }

  function azimuth(H, phi, dec) {
    return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi));
  }
  function altitude(H, phi, dec) {
    return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
  }

  function siderealTime(d, lw) {
    return rad * (280.16 + 360.9856235 * d) - lw;
  }

  function solarMeanAnomaly(d) {
    return rad * (357.5291 + 0.98560028 * d);
  }

  function eclipticLongitude(M) {
    const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)),
      P = rad * 102.9372;
    return M + C + P + PI;
  }

  function sunCoords(d) {
    const M = solarMeanAnomaly(d),
      L = eclipticLongitude(M);
    return {
      dec: declination(L, 0),
      ra: rightAscension(L, 0)
    };
  }

  function getSunPosition(date, lat, lng) {
    const lw = rad * -lng,
      phi = rad * lat,
      d = toDays(date),
      c = sunCoords(d),
      H = siderealTime(d, lw) - c.ra;

    return {
      azimuth: azimuth(H, phi, c.dec),
      altitude: altitude(H, phi, c.dec)
    };
  }

  function getSolarAltitudeRadians(date, latitude, longitude) {
    const latN = Number(latitude);
    const lngN = Number(longitude);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return NaN;
    return getSunPosition(date instanceof Date ? date : new Date(date), latN, lngN).altitude;
  }

  // ----- Horizon utils + gradient (from Horizon gradient.ts) -----
  /** @typedef {[number, number, number]} Vec3 */

  function clamp(x, min, max) {
    return Math.max(min, Math.min(max, x));
  }

  function dot(v1, v2) {
    return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  }

  function len(v) {
    return Math.hypot(v[0], v[1], v[2]);
  }

  function norm(v) {
    const l = len(v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function add(v1, v2) {
    return [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]];
  }

  function scale(v, s) {
    return [v[0] * s, v[1] * s, v[2] * s];
  }

  function expVec(v) {
    return [Math.exp(v[0]), Math.exp(v[1]), Math.exp(v[2])];
  }

  const RAYLEIGH_SCATTER = [5.802e-6, 13.558e-6, 33.1e-6];
  const MIE_SCATTER = 3.996e-6;
  const MIE_ABSORB = 4.44e-6;
  const OZONE_ABSORB = [0.65e-6, 1.881e-6, 0.085e-6];

  const RAYLEIGH_SCALE_HEIGHT = 8e3;
  const MIE_SCALE_HEIGHT = 1.2e3;

  const GROUND_RADIUS = 6360e3;
  const TOP_RADIUS = 6460e3;
  const SUN_INTENSITY = 1.0;

  const SAMPLES = 32;
  const FOV_DEG = 75;

  const EXPOSURE = 25.0;
  const GAMMA = 2.2;
  const SUNSET_BIAS_STRENGTH = 0.1;

  function aces(color) {
    return color.map((c) => {
      const n = c * (2.51 * c + 0.03);
      const d = c * (2.43 * c + 0.59) + 0.14;
      return Math.max(0, Math.min(1, n / d));
    });
  }

  function applySunsetBias(rgb) {
    const r = rgb[0],
      g = rgb[1],
      b = rgb[2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const w = 1.0 / (1.0 + 2.0 * lum);
    const k = SUNSET_BIAS_STRENGTH;
    const rb = 1.0 + 0.5 * k * w;
    const gb = 1.0 - 0.5 * k * w;
    const bb = 1.0 + 1.0 * k * w;
    return [Math.max(0, r * rb), Math.max(0, g * gb), Math.max(0, b * bb)];
  }

  function rayleighPhase(angle) {
    return (3 * (1 + Math.cos(angle) ** 2)) / (16 * PI);
  }

  function miePhase(angle) {
    const g = 0.8;
    const scale = 3 / (8 * PI);
    const num = (1 - g ** 2) * (1 + Math.cos(angle) ** 2);
    const denom = (2 + g ** 2) * (1 + g ** 2 - 2 * g * Math.cos(angle)) ** (3 / 2);
    return (scale * num) / denom;
  }

  function intersectSphere(p, d, r) {
    const m = p;
    const b = dot(m, d);
    const c = dot(m, m) - r ** 2;
    const discr = b ** 2 - c;
    if (discr < 0) return null;
    const t = -b - Math.sqrt(discr);
    if (t < 0) return -b + Math.sqrt(discr);
    return t;
  }

  function computeTransmittance(height, angle) {
    const rayOrigin = [0, GROUND_RADIUS + height, 0];
    const rayDirection = [Math.sin(angle), Math.cos(angle), 0];

    const distance = intersectSphere(rayOrigin, rayDirection, TOP_RADIUS);
    if (!distance) return [1, 1, 1];

    const segmentLength = distance / SAMPLES;
    let t = 0.5 * segmentLength;

    let odRayleigh = 0;
    let odMie = 0;
    let odOzone = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const pos = add(rayOrigin, scale(rayDirection, t));
      const h = len(pos) - GROUND_RADIUS;

      const dR = Math.exp(-h / RAYLEIGH_SCALE_HEIGHT);
      const dM = Math.exp(-h / MIE_SCALE_HEIGHT);

      odRayleigh += dR * segmentLength;

      const ozoneDensity = 1.0 - Math.min(Math.abs(h - 25e3) / 15e3, 1.0);
      odOzone += ozoneDensity * segmentLength;

      odMie += dM * segmentLength;
      t += segmentLength;
    }

    const tauR = [
      RAYLEIGH_SCATTER[0] * odRayleigh,
      RAYLEIGH_SCATTER[1] * odRayleigh,
      RAYLEIGH_SCATTER[2] * odRayleigh
    ];
    const tauM = [MIE_ABSORB * odMie, MIE_ABSORB * odMie, MIE_ABSORB * odMie];
    const tauO = [
      OZONE_ABSORB[0] * odOzone,
      OZONE_ABSORB[1] * odOzone,
      OZONE_ABSORB[2] * odOzone
    ];

    const tau = [-(tauR[0] + tauM[0] + tauO[0]), -(tauR[1] + tauM[1] + tauO[1]), -(tauR[2] + tauM[2] + tauO[2])];
    return expVec(tau);
  }

  /**
   * @returns {[string, Vec3, Vec3]} gradient CSS, zenith RGB, horizon RGB (0–255)
   */
  function renderHorizonGradient(altitude) {
    const cameraPosition = [0, GROUND_RADIUS, 0];
    const sunDirection = norm([Math.cos(altitude), Math.sin(altitude), 0]);

    const focalZ = 1.0 / Math.tan(((FOV_DEG * 0.5) * PI) / 180.0);

    const stops = [];
    for (let i = 0; i < SAMPLES; i++) {
      const s = i / (SAMPLES - 1);

      const viewDirection = norm([0, s, focalZ]);

      let inscattered = [0, 0, 0];

      const tExitTop = intersectSphere(cameraPosition, viewDirection, TOP_RADIUS);
      if (tExitTop !== null && tExitTop > 0) {
        const rayOrigin = cameraPosition.slice();

        const segmentLength = tExitTop / SAMPLES;
        let tRay = segmentLength * 0.5;

        const rayOriginRadius = len(rayOrigin);
        const isRayPointingDownwardAtStart = dot(rayOrigin, viewDirection) / rayOriginRadius < 0.0;
        const startHeight = rayOriginRadius - GROUND_RADIUS;
        const startRayCos = clamp(
          dot(
            [rayOrigin[0] / rayOriginRadius, rayOrigin[1] / rayOriginRadius, rayOrigin[2] / rayOriginRadius],
            viewDirection
          ),
          -1,
          1
        );
        const startRayAngle = Math.acos(Math.abs(startRayCos));
        const transmittanceCameraToSpace = computeTransmittance(startHeight, startRayAngle);

        for (let j = 0; j < SAMPLES; j++) {
          const samplePos = add(rayOrigin, scale(viewDirection, tRay));
          const sampleRadius = len(samplePos);
          const upUnit = [samplePos[0] / sampleRadius, samplePos[1] / sampleRadius, samplePos[2] / sampleRadius];
          const sampleHeight = sampleRadius - GROUND_RADIUS;

          const viewCos = clamp(dot(upUnit, viewDirection), -1, 1);
          const sunCos = clamp(dot(upUnit, sunDirection), -1, 1);
          const viewAngle = Math.acos(Math.abs(viewCos));
          const sunAngle = Math.acos(sunCos);

          const transmittanceToSpace = computeTransmittance(sampleHeight, viewAngle);

          const transmittanceCameraToSample = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            transmittanceCameraToSample[k] = isRayPointingDownwardAtStart
              ? transmittanceToSpace[k] / transmittanceCameraToSpace[k]
              : transmittanceCameraToSpace[k] / transmittanceToSpace[k];
          }

          const transmittanceLight = computeTransmittance(sampleHeight, sunAngle);

          const opticalDensityRay = Math.exp(-sampleHeight / RAYLEIGH_SCALE_HEIGHT);
          const opticalDensityMie = Math.exp(-sampleHeight / MIE_SCALE_HEIGHT);
          const sunViewCos = clamp(dot(sunDirection, viewDirection), -1, 1);
          const sunViewAngle = Math.acos(sunViewCos);
          const phaseR = rayleighPhase(sunViewAngle);
          const phaseM = miePhase(sunViewAngle);

          const scatteredRgb = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            const rayleighTerm = RAYLEIGH_SCATTER[k] * opticalDensityRay * phaseR;
            const mieTerm = MIE_SCATTER * opticalDensityMie * phaseM;
            scatteredRgb[k] = transmittanceLight[k] * (rayleighTerm + mieTerm);
          }

          for (let k = 0; k < 3; k++) {
            inscattered[k] += transmittanceCameraToSample[k] * scatteredRgb[k] * segmentLength;
          }
          tRay += segmentLength;
        }

        for (let k = 0; k < 3; k++) inscattered[k] *= SUN_INTENSITY;
      }

      let color = inscattered.slice();
      color = color.map((c) => c * EXPOSURE);
      color = applySunsetBias(color);
      color = aces(color);
      color = color.map((c) => Math.pow(c, 1.0 / GAMMA));
      const rgb = color.map((c) => Math.round(clamp(c, 0, 1) * 255));

      const percent = (1 - s) * 100;
      stops.push({ percent, rgb });
    }

    stops.sort((a, b) => a.percent - b.percent);
    const colorStops = stops
      .map(
        ({ percent, rgb }) =>
          `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}) ${Math.round(percent * 100) / 100}%`
      )
      .join(", ");

    return [
      `linear-gradient(to bottom, ${colorStops})`,
      stops[0].rgb,
      stops[stops.length - 1].rgb
    ];
  }

  global.getSolarAltitudeRadians = getSolarAltitudeRadians;
  global.renderHorizonGradient = renderHorizonGradient;
})(typeof window !== "undefined" ? window : globalThis);
