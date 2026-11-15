// Minimal WebGL2 pipeline:
//   background shader -> composite (x N subframes, accumulated = motion blur) -> bloom -> final post.
// opts.alpha = true renders a transparent background (for overlays composited onto video later).
import { VERT, SCENE, COMP, BRIGHT, BLUR, FINAL } from './shaders.js';

export function createPipeline(canvas, RW, RH, opts = {}) {
  const ALPHA = !!opts.alpha;
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: ALPHA, depth: false, stencil: false,
    preserveDrawingBuffer: true, premultipliedAlpha: false,
  });
  if (!gl) throw new Error('WebGL2 unavailable (is the GPU flag right for this OS? see render.mjs)');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
  gl.getExtension('OES_texture_float_linear');

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      throw new Error('Shader compile failed: ' + log + '\n' + lines.slice(0, 4000));
    }
    return s;
  }
  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed: ' + gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      uniforms[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    return { p, uniforms };
  }
  // Set uniforms by name; names the shader doesn't declare (or optimised away) are skipped.
  function use(prog, u) {
    gl.useProgram(prog.p);
    let unit = 0;
    for (const k in u) {
      const info = prog.uniforms[k];
      if (!info) continue;
      const v = u[k], L = info.loc;
      switch (info.type) {
        case gl.FLOAT: info.size > 1 ? gl.uniform1fv(L, v) : gl.uniform1f(L, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(L, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(L, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(L, v); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(L, v); break;
        case gl.SAMPLER_2D:
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, v);
          gl.uniform1i(L, unit++);
          break;
      }
    }
  }
  function texture(w, h, float) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA,
      float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h, float = true) {
    const t = texture(w, h, float);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { f, t, w, h };
  }
  function bind(tg) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.f : null);
    gl.viewport(0, 0, tg ? tg.w : RW, tg ? tg.h : RH);
  }
  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

  const P = { scene: program(SCENE), comp: program(COMP), bright: program(BRIGHT), blur: program(BLUR), final: program(FINAL) };
  const bgT = target(RW, RH), accT = target(RW, RH);
  const q1 = [Math.round(RW / 4), Math.round(RH / 4)], q2 = [Math.round(RW / 8), Math.round(RH / 8)];
  const b1a = target(...q1), b1b = target(...q1), b2a = target(...q2), b2b = target(...q2);
  const tex2D = texture(RW, RH, false), texHud = texture(RW, RH, false);

  function upload(tex, canvas2d) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
  }

  return {
    gl,
    alpha: ALPHA,
    beginFrame() { bind(accT); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
    // One motion-blur subframe. cfg comes from scene.frame(t, jit). use2D uploads the 2D canvas
    // (as uTex for the shader) and composites it on top; consume2D keeps the upload but skips the
    // composite, for looks that render the type inside the shader (liquid, ASCII).
    subframe(cfg, c2d, weight) {
      if (cfg.use2D) upload(tex2D, c2d);
      if (cfg.scene) {
        bind(bgT);
        gl.disable(gl.BLEND);
        use(P.scene, {
          uRes: [RW, RH], uT: cfg.t, uScene: cfg.scene, uL: cfg.l || 0,
          uP: cfg.P || [0, 0, 0, 0], uQ: cfg.Q || [0, 0, 0, 0], uR: cfg.R || [0, 0, 0, 0], uJit: cfg.jit,
          uTex: tex2D, uBlobs: cfg.blobs || new Float32Array(48),
        });
        draw();
      }
      bind(accT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      use(P.comp, {
        uBg: bgT.t, uL2: tex2D, uUseBg: cfg.scene ? 1 : 0, uUse2D: cfg.use2D && !cfg.consume2D ? 1 : 0,
        uBlend: cfg.blend || 0, uClear: cfg.clear || [0.043, 0.043, 0.051], uClearA: ALPHA ? 0 : 1,
        uCam: cfg.cam || [1, 0, 0, 0], uRes: [RW, RH], uW: weight,
      });
      draw();
      gl.disable(gl.BLEND);
    },
    endFrame(post, hudCanvas) {
      gl.disable(gl.BLEND);
      bind(b1a); use(P.bright, { uSrc: accT.t, uTexel: [1 / RW, 1 / RH], uThr: post.thr ?? 0.72 }); draw();
      for (let i = 0; i < 2; i++) {
        bind(b1b); use(P.blur, { uSrc: b1a.t, uDir: [1.5 / q1[0], 0] }); draw();
        bind(b1a); use(P.blur, { uSrc: b1b.t, uDir: [0, 1.5 / q1[1]] }); draw();
      }
      bind(b2a); use(P.bright, { uSrc: b1a.t, uTexel: [1 / q1[0], 1 / q1[1]], uThr: 0 }); draw();
      for (let i = 0; i < 2; i++) {
        bind(b2b); use(P.blur, { uSrc: b2a.t, uDir: [2 / q2[0], 0] }); draw();
        bind(b2a); use(P.blur, { uSrc: b2b.t, uDir: [0, 2 / q2[1]] }); draw();
      }
      upload(texHud, hudCanvas);
      bind(null);
      use(P.final, {
        uSrc: accT.t, uB1: b1a.t, uB2: b2a.t, uHud: texHud, uRes: [RW, RH], uT: post.t, uAlpha: ALPHA ? 1 : 0,
        uBloom: post.bloom ?? 0, uCA: post.ca ?? 0, uGlitch: post.glitch ?? 0, uGrain: post.grain ?? 0,
        uVig: post.vig ?? 0, uFlash: post.flash ?? 0, uFade: post.fade ?? 1, uHudA: post.hud ?? 0,
      });
      draw();
    },
  };
}
