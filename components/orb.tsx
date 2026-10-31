"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// The Orb: the Core's voice made visible. A glass sphere of swirling violet light drawn by one
// fragment shader — it breathes when idle, leans in and brightens while listening, churns while
// thinking, and pulses with the actual sound while speaking. Transparent around the edge, so it sits
// on whatever is behind it (the nebula card). No WebGL / reduced motion → a still CSS sphere.

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
const STATE: Record<OrbState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = p; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `precision highp float;
varying vec2 uv;
uniform float t, level, state, aspect, hue;

vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return -1.0 + 2.0*fract(sin(p)*43758.5453); }
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p), u = f*f*(3.0-2.0*f);
  return mix(mix(mix(dot(hash3(i),f), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + 1.7; a *= 0.5; } return s; }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
vec3 hueShift(vec3 c, float h){ const vec3 k = vec3(0.57735); float ca = cos(h); return c*ca + cross(k,c)*sin(h) + k*dot(k,c)*(1.0-ca); }

void main(){
  vec2 q = uv; q.x *= aspect;
  float listening = step(0.5, state) * (1.0 - step(1.5, state));
  float thinking  = step(1.5, state) * (1.0 - step(2.5, state));
  float speaking  = step(2.5, state);
  float pulse = level * (0.6*listening + 1.0*speaking);
  float R = 0.62 + 0.035*sin(t*1.3) + 0.07*pulse + 0.02*thinking*sin(t*6.0);
  float d = length(q);
  vec3 col = vec3(0.0); float alpha = 0.0;

  // Halo outside the sphere: soft violet bloom that swells with sound.
  float halo = exp(-max(d - R, 0.0) * (7.0 - 2.5*pulse)) * (0.28 + 0.5*pulse + 0.15*thinking);
  vec3 haloCol = hueShift(vec3(0.62, 0.36, 1.0), hue);
  col += haloCol * halo; alpha += halo * 0.9;

  if (d < R) {
    vec2 s = q / R;
    float z = sqrt(max(1.0 - dot(s,s), 0.0));
    vec3 n = vec3(s, z);
    float speed = 0.12 + 0.35*thinking + 0.25*pulse;
    vec3 pos = rotY(t*speed) * rotX(0.35 + 0.1*sin(t*0.2)) * n;
    // Swirling gas inside: domain-warped noise, looked at through the glass.
    vec3 w = pos*1.6 + vec3(0.0, 0.0, t*0.08);
    float warp = fbm(w + fbm(w*1.3 + t*speed*0.6));
    float swirl = fbm(pos*2.4 + warp*1.8 + vec3(t*0.05));
    vec3 deep = vec3(0.10, 0.03, 0.24);
    vec3 mid  = vec3(0.50, 0.22, 0.86);
    vec3 hot  = vec3(0.98, 0.62, 0.96);
    vec3 inner = mix(deep, mid, smoothstep(-0.25, 0.35, warp));
    inner = mix(inner, hot, smoothstep(0.15, 0.55, swirl) * (0.55 + 0.6*pulse + 0.3*thinking));
    // Teal veins, like the nebula behind it.
    float vein = smoothstep(0.02, 0.0, abs(fbm(pos*3.2 - t*0.07) - 0.05));
    inner += vec3(0.25, 0.85, 0.85) * vein * 0.35;
    inner = hueShift(inner, hue);
    // Glass: darker toward the middle-bottom, rim light, a specular highlight top-left.
    float fres = pow(1.0 - z, 2.4);
    float light = 0.55 + 0.45*dot(n, normalize(vec3(-0.5, 0.6, 0.6)));
    vec3 c = inner * light;
    c += hueShift(vec3(0.75, 0.55, 1.0), hue) * fres * (0.9 + 0.8*pulse);
    float spec = pow(max(dot(reflect(vec3(0,0,-1), n), normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 28.0);
    c += vec3(1.0) * spec * 0.75;
    float edge = smoothstep(R, R - 0.012, d);
    col = mix(col, c, edge);
    alpha = mix(alpha, 1.0, edge);
  }
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied
}`;

function makeGL(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return null;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = sh(gl.VERTEX_SHADER, VERT);
  const f = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!v || !f) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  return { gl, t: u("t"), level: u("level"), state: u("state"), aspect: u("aspect"), hue: u("hue") };
}

export function Orb({ state = "idle", level = 0, hue = 0, className, label }: { state?: OrbState; level?: number; hue?: number; className?: string; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLSpanElement>(null);
  // Props change every frame while speaking; the render loop reads them from a ref.
  const live = useRef({ state, level, hue });
  live.current = { state, level, hue };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = makeGL(el);
    if (!ctx) {
      el.style.display = "none";
      if (fallback.current) fallback.current.style.display = "block";
      return;
    }
    const { gl } = ctx;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let visible = true;
    let smooth = 0;
    const start = performance.now();
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const draw = (now: number) => {
      size();
      // Ease the level so the sphere swells, rather than jitters, with speech.
      smooth += (live.current.level - smooth) * 0.25;
      gl.uniform1f(ctx.t, reduce.matches ? 4 : (now - start) / 1000);
      gl.uniform1f(ctx.level, Math.min(1, Math.max(0, smooth)));
      gl.uniform1f(ctx.state, STATE[live.current.state] ?? 0);
      gl.uniform1f(ctx.aspect, el.width / el.height);
      gl.uniform1f(ctx.hue, live.current.hue);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const loop = (now: number) => {
      draw(now);
      raf = visible && !document.hidden && !reduce.matches ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", wake);
    reduce.addEventListener("change", wake);
    // With reduced motion it still redraws when the state changes (a still frame per state).
    const still = reduce.matches ? setInterval(() => draw(performance.now()), 500) : undefined;
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(still);
      io.disconnect();
      document.removeEventListener("visibilitychange", wake);
      reduce.removeEventListener("change", wake);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <span className={cn("relative block", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <span
        ref={fallback}
        className="absolute inset-[19%] hidden rounded-full"
        style={{ background: "radial-gradient(circle at 35% 30%, #f6c8ff 0%, #a15ef0 28%, #4a1d8f 62%, #1a0838 100%)", boxShadow: "0 0 40px 6px rgb(161 94 240 / 0.45)" }}
      />
    </span>
  );
}

// The orb in its nebula: a looping Magnific nebula clip, the orb, and a comet arcing past.
export function NebulaCard({ state = "idle", level = 0, hue = 0, className, children }: { state?: OrbState; level?: number; hue?: number; className?: string; children?: React.ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Only play while on screen; never with reduced motion (the poster stays).
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reduce.matches) void v.play().catch(() => {});
      else v.pause();
    });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <div className={cn("nebula-card relative isolate overflow-hidden", className)} data-state={state}>
      <video ref={video} className="absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-90" src="/media/nebula-loop.mp4" poster="/media/nebula-loop.webp" muted loop playsInline preload="metadata" aria-hidden />
      <span className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_45%,transparent_30%,rgb(8_8_10/0.65)_100%)]" aria-hidden />
      <svg className="comet pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="comet-tail" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path d="M 58 78 Q 86 70 88 42" fill="none" stroke="url(#comet-tail)" strokeWidth="0.9" strokeLinecap="round" />
      </svg>
      <Orb state={state} level={level} hue={hue} className="orb-float absolute inset-0 m-auto aspect-square h-[78%] max-h-full" />
      {children}
    </div>
  );
}
