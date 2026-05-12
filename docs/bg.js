(() => {
  const canvas = document.getElementById("bg");
  if (!canvas) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
  if (!gl) {
    canvas.style.display = "none";
    return;
  }

  const vert = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  // Liquid glass — translucent flowing form with caustics and soft refractive highlights.
  const frag = `
    precision highp float;
    uniform vec2  uRes;
    uniform float uTime;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // Domain-warped swirl — large-scale flow.
    vec2 swirl(vec2 p, float t){
      float a = sin(p.y * 0.7 + t * 0.25) * 0.8 + cos(p.x * 0.5 - t * 0.18) * 0.7;
      return vec2(cos(a), sin(a)) * 0.55;
    }

    // Smooth liquid height field.
    float height(vec2 p, float t){
      p += swirl(p, t);
      float h = 0.0;
      h += sin(p.x * 1.3 + t * 0.55 + sin(p.y * 0.9 + t * 0.3) * 1.8) * 0.62;
      h += sin(p.y * 1.9 - t * 0.45 + cos(p.x * 1.1 - t * 0.25) * 1.3) * 0.47;
      h += sin((p.x * 0.6 + p.y * 1.2) - t * 0.6) * 0.38;
      h += sin(p.x * 2.8 + p.y * 2.4 + t * 0.85) * 0.14;
      h += sin(p.x * 5.5 - p.y * 4.1 - t * 1.2) * 0.05;
      return h;
    }

    // Caustic web — bright thin curves of focused light.
    float caustic(vec2 p, float t){
      vec2 q = p + swirl(p * 1.2, t * 0.9);
      float c = 0.0;
      c += abs(sin(q.x * 3.1 + sin(q.y * 2.3 + t * 0.6) * 1.9));
      c += abs(sin(q.y * 2.7 - sin(q.x * 1.9 - t * 0.5) * 1.5));
      c = 1.0 - smoothstep(0.04, 0.42, c * 0.5);
      return c;
    }

    void main(){
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
      float t = uTime * 0.32;

      // Liquid silhouette — undulating upper edge.
      float silhouetteY = -0.02
        + sin(uv.x * 1.2 + t * 0.45) * 0.22
        + sin(uv.x * 2.4 - t * 0.3)  * 0.08
        + sin(uv.x * 4.8 + t * 0.7)  * 0.025
        - 0.05;
      float edge = smoothstep(0.03, -0.03, uv.y - silhouetteY);

      // Surface height + normal.
      float e = 0.012;
      float h  = height(uv, t);
      float hx = height(uv + vec2(e, 0.0), t);
      float hy = height(uv + vec2(0.0, e), t);
      vec3 n = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.0));

      vec3 keyDir  = normalize(vec3(0.45, 0.85, 0.55));
      vec3 fillDir = normalize(vec3(-0.5, -0.3, 0.7));
      vec3 viewDir = vec3(0.0, 0.0, 1.0);

      float diffuse = max(dot(n, keyDir), 0.0);
      float fill    = max(dot(n, fillDir), 0.0) * 0.28;

      // Frosted spec.
      vec3 halfDir = normalize(keyDir + viewDir);
      float spec = pow(max(dot(n, halfDir), 0.0), 22.0);
      spec *= smoothstep(0.45, 0.95, diffuse);

      // Fresnel.
      float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);

      // Refraction sample — caustics through "glass thickness".
      vec2 refr = uv + n.xy * 0.28;
      float caus = caustic(refr * 1.6, t);

      // Two drifting focal "sun" hotspots — wandering pools of warm light.
      vec2 sunA = vec2(sin(t * 0.35) * 0.6, -0.15 + cos(t * 0.28) * 0.35);
      vec2 sunB = vec2(cos(t * 0.22 + 1.7) * 0.7, -0.45 + sin(t * 0.31 + 0.6) * 0.30);
      float glowA = 0.55 / (0.15 + dot(uv - sunA, uv - sunA) * 3.0);
      float glowB = 0.40 / (0.15 + dot(uv - sunB, uv - sunB) * 3.5);

      // Depth.
      float depth = smoothstep(-1.0, 0.5, uv.y);

      // Glass palette — warm amber with a hint of magenta in the cooler valleys.
      vec3 deepShadow = vec3(0.04, 0.015, 0.012);
      vec3 plumValley = vec3(0.18, 0.05, 0.10);    // subtle cool color in shadow pools
      vec3 bodyAmber  = vec3(0.70, 0.22, 0.06);
      vec3 midOrange  = vec3(0.98, 0.46, 0.15);
      vec3 hotOrange  = vec3(1.00, 0.68, 0.30);
      vec3 frostTint  = vec3(1.00, 0.82, 0.60);
      vec3 causTint   = vec3(1.00, 0.88, 0.62);

      vec3 glass = deepShadow;
      glass = mix(glass, bodyAmber, diffuse * 0.65);
      glass = mix(glass, midOrange, diffuse * diffuse * 0.95);
      glass = mix(glass, hotOrange, pow(diffuse, 3.5) * 0.7);
      glass += bodyAmber * fill;
      glass += causTint * caus * 0.42 * depth;     // brighter caustics
      glass += frostTint * spec * 0.55;
      glass += hotOrange * fres * 0.25;
      glass += hotOrange * glowA * 0.18;           // drifting hotspot A
      glass += midOrange * glowB * 0.14;           // drifting hotspot B

      // Drifting shadow pools — but gentler floor so it doesn't go murky.
      float pools = sin(uv.x * 0.7 - t * 0.3) * sin(uv.y * 0.9 + t * 0.25)
                  + sin((uv.x - uv.y) * 0.55 - t * 0.2) * 0.5;
      float pool = smoothstep(-0.4, 1.2, pools);
      // Tint the pools toward plum instead of just darkening — adds color variation.
      glass = mix(glass * 0.55 + plumValley * 0.25, glass, pool);

      // Body fade — keep some life at the bottom.
      float bodyFade = smoothstep(-1.3, 0.6, uv.y);
      glass *= 0.55 + 0.55 * bodyFade;

      // Void above the silhouette — black with a soft warm bloom near the edge.
      vec3 voidCol = vec3(0.0);
      float bloom = smoothstep(0.28, 0.0, abs(uv.y - silhouetteY)) * 0.22;
      voidCol += hotOrange * bloom * edge;

      // Distant warm fog rising into the void — a subtle gradient toward the silhouette.
      float fog = smoothstep(0.6, -0.05, uv.y - silhouetteY) * 0.06;
      voidCol += bodyAmber * fog * (1.0 - edge);

      vec3 col = mix(voidCol, glass, edge);

      // Vignette — softer.
      float vig = smoothstep(1.45, 0.4, length(uv * vec2(0.9, 1.1)));
      col *= 0.62 + 0.38 * vig;

      // Gentle tonemap to keep highlights from clipping while preserving punch.
      col = col / (1.0 + col * 0.6);

      // Grain.
      col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, vert);
  const fs = compile(gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) {
    canvas.style.display = "none";
    return;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const pLoc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(pLoc);
  gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");

  // Render at half resolution for perf — the effect is soft anyway.
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const scale = 0.7;
    const w = Math.max(1, Math.floor(window.innerWidth * dpr * scale));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    }
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });

  let start = performance.now();
  let frozenT = 0;
  let visible = !document.hidden;
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) start = performance.now() - frozenT * 1000;
  });

  function frame(now) {
    if (!visible) {
      requestAnimationFrame(frame);
      return;
    }
    const t = reduced ? 0 : (now - start) / 1000;
    frozenT = t;
    gl.uniform1f(uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!reduced) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
