/*
 * OnScreenPrinter renderer (WebGL2)
 *
 * Pass 1 (分版): 元画像 → トーン/色味補正 → CMYK 各版の網点面積率 (RGBA8, ガンマ符号化)
 * Pass 2 (印刷): 各版をスクリーニング(網点化)し、紙の上にインキを減法混色で重ねる
 *
 * 計算はすべてリニアライト(反射率)で行う。網点は画像座標系で定義されるので、
 * プレビューの拡大率や書き出し解像度に依らず同じ絵柄になる。
 */
(function () {
  'use strict';

  const LUT_W = 512;
  const BLUE_N = 128;

  const VS = `#version 300 es
in vec2 a_pos;
uniform vec2 u_canvas;
uniform vec2 u_origin;
uniform vec2 u_extent;
uniform float u_flip;
out vec2 v_uv;
void main() {
  vec2 px = a_pos * u_canvas;
  v_uv = (px - u_origin) / u_extent;
  gl_Position = vec4(a_pos.x * 2.0 - 1.0, (a_pos.y * 2.0 - 1.0) * u_flip, 0.0, 1.0);
}`;

  const COMMON = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;

  // ---------------------------------------------------------------- Pass 1
  const FS_SEP = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_fade;
uniform float u_temp, u_tint, u_sat;
uniform float u_gcr, u_accuracy;
uniform int u_colorMode;      // 0: CMYK, 1: スミ1色, 2: ダブルトーン
uniform vec3 u_A[3];          // C, M, Y インキの吸収率 (1 - 反射率)
uniform vec3 u_Ak;            // K インキの吸収率
${COMMON}
// 目標反射率 T を再現する CMY 面積率をニュートン法で解く (インキの濁りの補正)
vec3 solveCMY(vec3 T) {
  vec3 a = clamp(1.0 - T, 0.0, 1.0);
  vec3 lt = log(max(T, vec3(0.002)));
  for (int it = 0; it < 6; it++) {
    vec3 tc = 1.0 - a.x * u_A[0];
    vec3 tm = 1.0 - a.y * u_A[1];
    vec3 ty = 1.0 - a.z * u_A[2];
    vec3 f = log(tc) + log(tm) + log(ty) - lt;
    mat3 J = mat3(-u_A[0] / tc, -u_A[1] / tm, -u_A[2] / ty);
    a = clamp(a - inverse(J) * f, 0.0, 1.0);
  }
  return a;
}
void main() {
  vec3 lin = s2l(texture(u_src, v_uv).rgb);
  lin *= exp2(u_exposure);
  vec3 gains = vec3(1.0 + 0.22 * u_temp, 1.0 - 0.18 * u_tint, 1.0 - 0.22 * u_temp);
  gains /= dot(gains, LUMA);
  lin *= gains;
  vec3 p = l2s(clamp(lin, 0.0, 1.0));

  // コントラスト (S字)
  float g = exp(u_contrast * 1.1);
  p = mix(0.5 * pow(2.0 * p, vec3(g)), 1.0 - 0.5 * pow(2.0 * (1.0 - p), vec3(g)), step(0.5, p));

  // シャドウ / ハイライト
  float L = dot(p, LUMA);
  float ws = 6.75 * L * (1.0 - L) * (1.0 - L);
  float wh = 6.75 * L * L * (1.0 - L);
  p += 0.28 * (u_shadows * ws + u_highlights * wh);

  // 彩度
  L = dot(p, LUMA);
  p = mix(vec3(L), p, 1.0 + u_sat);

  // フェード (黒の持ち上げ)
  p = clamp(p, 0.0, 1.0);
  p = p * (1.0 - 0.22 * u_fade) + 0.22 * u_fade;

  vec3 T = max(s2l(p), vec3(0.0005));
  vec3 cmy = vec3(0.0);
  float k = 0.0;
  if (u_colorMode == 0) {
    float m = 1.0 - max(T.r, max(T.g, T.b));
    k = u_gcr * m * smoothstep(0.05, 0.9, m);
    vec3 T2 = clamp(T / (1.0 - k * u_Ak), 0.0, 1.0);
    cmy = mix(1.0 - T2, solveCMY(T2), u_accuracy);
  } else if (u_colorMode == 1) {
    float lum = dot(T, LUMA);
    k = clamp((1.0 - lum) / dot(u_Ak, LUMA), 0.0, 1.0);
  } else {
    float t = 1.0 - dot(T, LUMA);
    k = clamp(pow(t, 1.7) * 0.92, 0.0, 1.0);
    cmy.x = clamp(pow(t, 0.85), 0.0, 1.0);   // 特色版は C のスロットに入れる
  }
  vec4 a = clamp(vec4(cmy, k), 0.0, 1.0);
  o = 1.0 - pow(1.0 - a, vec4(1.0 / 2.2));   // シャドウの階調を守るためガンマ符号化
}`;

  // ---------------------------------------------------------------- Pass 2
  const FS_PRINT = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_cmyk, u_src, u_lut, u_blue;
uniform vec2 u_img;
uniform float u_ppw;          // 画像幅あたりの出力ピクセル数
uniform int u_method;         // 0 連続階調 1 オフセット 2 FM 3 グラビア 4 活版 5 リソ
uniform int u_shape;          // 0 丸 1 チェーン 2 ライン
uniform int u_bypass;
uniform float u_freq, u_angle, u_dotGain, u_spread, u_sharp;
uniform vec2 u_misreg[4];
uniform vec3 u_ink[4];
uniform vec4 u_dens;
uniform vec3 u_paper;
uniform float u_paperTex, u_mottle, u_grain, u_matte;
uniform vec3 u_bg;
uniform int u_scan;           // 1: スキャナの画素格子へ描画中
uniform float u_scanBlur;     // スキャナ光学系のぼけ (σ, スキャン画素)
uniform vec2 u_seed;          // むら・紙目・粒状の乱数オフセット
${COMMON}
const float TAU = 6.2831853;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s / 0.9375;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float chan(vec4 v, int i) { return i == 0 ? v.r : (i == 1 ? v.g : (i == 2 ? v.b : v.a)); }

// 版 i の網点面積率を読む (ぼかし / シャープを含む)
float readCh(int i, vec2 uv) {
  float lod0 = max(0.0, log2(u_img.x / u_ppw));
  if (u_scan == 1) lod0 = max(lod0, log2(max(1.0, 2.5 * u_scanBlur * u_img.x / u_ppw)));
  float soft = max(0.0, -u_sharp);
  float lod = max(lod0, log2(1.0 + soft * u_img.x / 250.0));
  float e = chan(textureLod(u_cmyk, uv, lod), i);
  if (u_sharp > 0.0) {
    float b = chan(textureLod(u_cmyk, uv, lod + 2.0), i);
    e += u_sharp * 1.5 * (e - b);
  }
  e = clamp(e, 0.0, 1.0);
  return 1.0 - pow(1.0 - e, 2.2);
}

float edgeGuard(float cov, float v) {
  cov *= smoothstep(0.0, 0.02, v);
  return mix(cov, 1.0, smoothstep(0.985, 1.0, v));
}
float screenAngle(int i) {
  return radians(u_angle + (i == 0 ? 15.0 : (i == 1 ? 75.0 : (i == 2 ? 0.0 : 45.0))));
}

// AM スクリーン (オフセット / 活版)。dm はインキ膜厚の倍率 (活版のマージナルゾーン用)
float screenAM(int i, vec2 q, float v, float ppc, bool press, out float dm) {
  dm = 1.0;
  vec2 g = rot(screenAngle(i)) * q * u_freq;
  float e, gr;
  if (u_shape == 2) {
    e = v - abs(fract(g.x) - 0.5) * 2.0;
    gr = 2.0;
  } else {
    float kx = TAU * g.x, ky = TAU * g.y;
    float w = u_shape == 1 ? 0.6 : 1.0;
    float s = (cos(kx) + w * cos(ky)) / (2.0 * (1.0 + w)) + 0.5;
    float lw = float(${LUT_W});
    float thr = texture(u_lut, vec2(v * (lw - 1.0) / lw + 0.5 / lw, u_shape == 1 ? 0.75 : 0.25)).r;
    e = s - thr;
    gr = TAU / (2.0 * (1.0 + w)) * length(vec2(sin(kx), w * sin(ky)));
  }
  gr = max(gr, 0.3);
  float d = e / gr;                       // 網点の縁からの概算距離 (セル単位)
  if (press) d += (vnoise(g * 5.0 + float(i) * 9.1) - 0.5) * 0.07;
  float aaw = 1.0 + u_spread * 0.35 * ppc;
  float cov = clamp(d * ppc / aaw + 0.5, 0.0, 1.0);
  cov = edgeGuard(cov, v);
  float vis = smoothstep(1.3, 3.0, ppc);
  if (press) {
    float rim = exp(-pow(d / 0.07, 2.0));
    dm = mix(1.0, 0.68 + 0.8 * rim, vis);
  }
  return mix(v, cov, vis);
}

// FM (ストキャスティック) スクリーン。rough > 0 でリソグラフ風の荒れた粒
float screenFM(int i, vec2 q, float v, float ppc, float rough) {
  vec2 g = q * u_freq + vec2(float(i) * 37.3, float(i) * 17.7);
  vec2 cell = floor(g);
  float thr = texture(u_blue, (cell + 0.5) / float(${BLUE_N})).r;
  // しきい値の分布を一様に保ったまま乱す (偏ると階調が潰れる)
  thr = fract(thr + (hash21(cell + float(i) * 7.0) - 0.5) * rough);
  // しきい値を超えたセルに角丸の点を置く。淡部では小さな孤立点、濃部ではセルを埋める
  vec2 f = abs(fract(g) - 0.5);
  float d = pow(pow(f.x, 4.0) + pow(f.y, 4.0), 0.25);
  float R = 0.5 * clamp(mix(0.75, 1.25, smoothstep(0.25, 0.6, v)) + (v - thr) * 6.0, 0.0, 1.25);
  float aaw = 1.0 + u_spread * 0.35 * ppc;
  float cov = step(thr, v) * clamp((R - d) * ppc / aaw + 0.5, 0.0, 1.0);
  cov = edgeGuard(cov, v);
  return mix(v, cov, smoothstep(1.3, 3.0, ppc));
}

// グラビア: 一定ピッチのセル。濃度はセルの大きさと深さ(インキ量)の両方で変わり、
// シャドウではインキが流れてセル壁が消える。ハイライトでは網点の抜けが起きる。
float screenGravure(int i, vec2 q, float v, float ppc) {
  float ang = radians(u_angle + (i == 0 ? 30.0 : (i == 1 ? 60.0 : (i == 2 ? 0.0 : 45.0))));
  vec2 g = rot(ang) * q * u_freq;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float area = clamp(0.18 + 0.72 * v, 0.0, 0.9);
  float d = 0.5 * sqrt(area) - max(abs(f.x), abs(f.y));
  float aaw = 1.0 + (0.18 + u_spread * 0.5) * ppc;
  float c = clamp(d * ppc / aaw + 0.5, 0.0, 1.0);
  float a = c * clamp(v / area, 0.0, 1.0);
  float skip = step(hash21(cell + float(i) * 13.0), 0.5 * (1.0 - smoothstep(0.02, 0.22, v)));
  a *= 1.0 - skip;
  a = mix(a, v, smoothstep(0.35, 0.95, v) * 0.85);
  return mix(v, a, smoothstep(1.3, 3.0, ppc));
}

// 4版ぶんのインキ層の透過率。val は各版の網点面積率、ppc は網点1個あたりの標本数
vec3 inkLayer(vec2 uv, float aspect, vec4 val, float ppc, float mott) {
  vec3 r = vec3(1.0);
  for (int i = 0; i < 4; i++) {
    vec2 uvi = uv + u_misreg[i];
    vec2 qi = vec2(uvi.x, uvi.y * aspect);
    float v = val[i];
    float dm = 1.0;
    float cov = v;
    if (u_method == 1) cov = screenAM(i, qi, v, ppc, false, dm);
    else if (u_method == 2) cov = screenFM(i, qi, v, ppc, 0.0);
    else if (u_method == 3) cov = screenGravure(i, qi, v, ppc);
    else if (u_method == 4) cov = screenAM(i, qi, v, ppc, true, dm);
    else if (u_method == 5) cov = screenFM(i, qi, v, ppc, 0.25);
    vec3 T = pow(u_ink[i], vec3(max(0.0, u_dens[i] * mott * dm)));
    r *= mix(vec3(1.0), T, cov);
  }
  return r;
}

void main() {
  if (v_uv.x < 0.0 || v_uv.x > 1.0 || v_uv.y < 0.0 || v_uv.y > 1.0) { o = vec4(u_bg, 1.0); return; }
  if (u_bypass == 1) { o = vec4(texture(u_src, v_uv).rgb, 1.0); return; }

  float aspect = u_img.y / u_img.x;
  vec2 q = vec2(v_uv.x, v_uv.y * aspect);
  vec2 qs = q + u_seed;
  float ppc = u_ppw / u_freq;

  // 紙
  vec3 paper = u_paper;
  float fib = fbm(qs * vec2(170.0, 520.0));
  float speck = vnoise(qs * 1500.0);
  paper *= 1.0 - u_paperTex * (0.16 * (fib - 0.5) + 0.07 * (speck - 0.5));

  // インキむら
  float mott = 1.0 + u_mottle * ((fbm(qs * 7.0) - 0.5) * 1.2 + (fbm(qs * 90.0) - 0.5) * 0.7);
  if (u_method == 5) mott *= 1.0 + 0.3 * (fbm(vec2(qs.x * 3.0, qs.y * 45.0)) - 0.5);

  vec4 val;
  for (int i = 0; i < 4; i++) {
    float v = readCh(i, v_uv + u_misreg[i]);
    val[i] = clamp(v + u_dotGain * 4.0 * v * (1.0 - v), 0.0, 1.0);
  }

  vec3 ink;
  if (u_scan == 1) {
    // スキャン: 画素ごとに、網点をガウス窓で積分する (網点と画素格子の干渉もここで生じる)
    const int N = 4;
    float sigma = max(u_scanBlur, 0.35);
    float R = max(0.5, 2.0 * sigma);
    float tapPpc = ppc * float(N) / (2.0 * R);
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int y = 0; y < N; y++) {
      for (int x = 0; x < N; x++) {
        vec2 d = ((vec2(float(x), float(y)) + 0.5) / float(N) * 2.0 - 1.0) * R;
        float w = exp(-dot(d, d) / (2.0 * sigma * sigma));
        acc += w * inkLayer(v_uv + d / vec2(u_ppw, u_ppw * aspect), aspect, val, tapPpc, mott);
        wsum += w;
      }
    }
    ink = acc / wsum;
  } else {
    ink = inkLayer(v_uv, aspect, val, ppc, mott);
  }
  vec3 res = paper * ink;

  // 表面反射による黒浮き (マット感)
  res = res * (1.0 - 0.06 * u_matte) + 0.06 * u_matte * u_paper;

  vec3 s = l2s(clamp(res, 0.0, 1.0));
  float gn = vnoise(qs * 1100.0 + 31.7) + vnoise(qs * 2300.0 + 5.3) - 1.0;
  s += gn * u_grain * 0.14;
  o = vec4(clamp(s, 0.0, 1.0), 1.0);
}`;

  // スキャン結果 (または任意のテクスチャ) を表示するだけのパス
  const FS_SHOW = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform vec3 u_bg;
void main() {
  if (v_uv.x < 0.0 || v_uv.x > 1.0 || v_uv.y < 0.0 || v_uv.y > 1.0) { o = vec4(u_bg, 1.0); return; }
  o = vec4(texture(u_tex, v_uv).rgb, 1.0);
}`;

  const BG = [0.941, 0.941, 0.941];
  const A4_SHORT_INCH = 8.268, A4_LONG_INCH = 11.693;

  const METHOD_ID = { none: 0, offset: 1, fm: 2, gravure: 3, letterpress: 4, riso: 5 };
  const SHAPE_ID = { round: 0, ellipse: 1, line: 2 };
  const COLOR_MODE_ID = { cmyk: 0, mono: 1, duotone: 2 };

  // インキセット (sRGB)。順に C, M, Y, K
  const INK_SETS = {
    process: ['#009fe1', '#e1007a', '#ffeb00', '#211f1f'],
    vintage: ['#1a94c7', '#d42a6b', '#fadb1f', '#33302c'],
    riso: ['#0078bf', '#ff48b0', '#ffe800', '#262626'],
  };

  // 版ズレの方向 (C, M, Y, K)
  const MISREG_DIR = [[1.0, 0.35], [-0.6, 0.8], [0.25, -1.0], [0.0, 0.0]];

  function hexToLinear(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
  }

  // 網点形状ごとの「面積率 → スポット関数のしきい値」LUT (階調を正確に保つため)
  function buildDotLut() {
    const N = 256;
    const data = new Uint8Array(LUT_W * 2);
    [1.0, 0.6].forEach((w, row) => {
      const vals = new Float32Array(N * N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const kx = (2 * Math.PI * (x + 0.5)) / N, ky = (2 * Math.PI * (y + 0.5)) / N;
          vals[y * N + x] = (Math.cos(kx) + w * Math.cos(ky)) / (2 * (1 + w)) + 0.5;
        }
      }
      vals.sort();
      for (let i = 0; i < LUT_W; i++) {
        const v = i / (LUT_W - 1);
        const idx = Math.min(vals.length - 1, Math.max(0, Math.round((1 - v) * (vals.length - 1))));
        data[row * LUT_W + i] = Math.round(vals[idx] * 255);
      }
    });
    return data;
  }

  // ブルーノイズ (void-and-cluster の簡易版): 最も空いている場所に順に点を置く
  function buildBlueNoise(N) {
    const n2 = N * N;
    const energy = new Float32Array(n2);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n2; i++) energy[i] = rnd() * 1e-3;
    const R = 6, sigma = 1.9;
    const kernel = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        kernel.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
      }
    }
    const out = new Uint8Array(n2);
    for (let rank = 0; rank < n2; rank++) {
      let best = 0, bestE = Infinity;
      for (let i = 0; i < n2; i++) if (energy[i] < bestE) { bestE = energy[i]; best = i; }
      const bx = best % N, by = (best / N) | 0;
      energy[best] = Infinity;
      for (let k = 0; k < kernel.length; k += 3) {
        const x = (bx + kernel[k] + N) % N, y = (by + kernel[k + 1] + N) % N;
        energy[y * N + x] += kernel[k + 2];
      }
      out[best] = Math.min(255, Math.floor(((rank + 0.5) / n2) * 256));
    }
    return out;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL2 が利用できません');
      this.gl = gl;
      this.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
      this.maxExport = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);

      this.progSep = this._program(VS, FS_SEP);
      this.progPrint = this._program(VS, FS_PRINT);
      this.progShow = this._program(VS, FS_SHOW);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      this.lutTex = this._dataTexture(LUT_W, 2, buildDotLut(), gl.LINEAR, gl.CLAMP_TO_EDGE);
      this.blueTex = null;   // 初回に FM / リソを使うとき生成
      this.fbo = gl.createFramebuffer();
      this.srcTex = null;
      this.cmykTex = null;
      this.imgW = 0;
      this.imgH = 0;
      this.sepKey = null;
      this.scanTex = null;
      this.scanW = 0;
      this.scanH = 0;
      this.scanKey = null;
    }

    _program(vsSrc, fsSrc) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.bindAttribLocation(p, 0, 'a_pos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const locs = {};
      return { p, loc: (name) => (name in locs ? locs[name] : (locs[name] = gl.getUniformLocation(p, name))) };
    }

    _dataTexture(w, h, data, filter, wrap) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    }

    /** 画像 (HTMLImageElement / ImageBitmap / Canvas) を作業解像度で取り込む */
    setImage(source, srcW, srcH) {
      const gl = this.gl;
      const k = Math.min(1, this.maxTex / Math.max(srcW, srcH));
      const w = Math.max(1, Math.round(srcW * k)), h = Math.max(1, Math.round(srcH * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, w, h);

      if (this.srcTex) gl.deleteTexture(this.srcTex);
      if (this.cmykTex) gl.deleteTexture(this.cmykTex);

      this.srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.cmykTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.cmykTex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.imgW = w;
      this.imgH = h;
      this.sepKey = null;
      this.scanKey = null;
    }

    _inks(P) {
      const set = (INK_SETS[P.inkSet] || INK_SETS.process).slice();
      if (P.colorMode === 'duotone') set[0] = P.spotColor;
      return set.map((hex) => hexToLinear(hex).map((v) => Math.max(v, 0.02)));
    }

    _separate(P, inks) {
      const gl = this.gl;
      const key = JSON.stringify([P.exposure, P.contrast, P.highlights, P.shadows, P.fade, P.temp, P.tint,
        P.sat, P.gcr, P.accuracy, P.colorMode, inks]);
      if (key === this.sepKey) return;
      this.sepKey = key;

      const pr = this.progSep;
      gl.useProgram(pr.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cmykTex, 0);
      gl.viewport(0, 0, this.imgW, this.imgH);
      gl.uniform2f(pr.loc('u_canvas'), 1, 1);
      gl.uniform2f(pr.loc('u_origin'), 0, 0);
      gl.uniform2f(pr.loc('u_extent'), 1, 1);
      gl.uniform1f(pr.loc('u_flip'), 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(pr.loc('u_src'), 0);
      for (const name of ['exposure', 'contrast', 'highlights', 'shadows', 'fade', 'temp', 'tint', 'sat', 'gcr', 'accuracy']) {
        gl.uniform1f(pr.loc('u_' + name), P[name]);
      }
      gl.uniform1i(pr.loc('u_colorMode'), COLOR_MODE_ID[P.colorMode] || 0);
      const A = [];
      for (let i = 0; i < 3; i++) A.push(...inks[i].map((v) => 1 - v));
      gl.uniform3fv(pr.loc('u_A'), new Float32Array(A));
      gl.uniform3fv(pr.loc('u_Ak'), new Float32Array(inks[3].map((v) => 1 - v)));
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, this.cmykTex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    /** 画像の幅を A4 の幅に合わせたときの幅 (インチ)。横長の画像は A4 横置きとみなす */
    pageWidthInch() {
      return this.imgH >= this.imgW ? A4_SHORT_INCH : A4_LONG_INCH;
    }

    /** スキャン画像の画素数 */
    scanSize(P) {
      const w = parseInt(P.scanDpi, 10) * this.pageWidthInch();
      const h = (w * this.imgH) / this.imgW;
      const k = Math.min(1, this.maxExport / Math.max(w, h));
      return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
    }

    /**
     * 印刷パス。target = {fbo, w, h, originX, originY, extentW, extentH, flip, bypass, scan}
     */
    _print(P, inks, t) {
      const gl = this.gl;
      const method = METHOD_ID[P.method] || 0;
      if ((method === 2 || method === 5) && !this.blueTex) {
        this.blueTex = this._dataTexture(BLUE_N, BLUE_N, buildBlueNoise(BLUE_N), gl.NEAREST, gl.REPEAT);
      }
      const pr = this.progPrint;
      gl.useProgram(pr.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.w, t.h);
      gl.uniform2f(pr.loc('u_canvas'), t.w, t.h);
      gl.uniform2f(pr.loc('u_origin'), t.originX, t.originY);
      gl.uniform2f(pr.loc('u_extent'), t.extentW, t.extentH);
      gl.uniform1f(pr.loc('u_flip'), t.flip);

      const bind = (unit, tex, name) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(pr.loc(name), unit);
      };
      bind(0, this.srcTex, 'u_src');
      bind(1, this.cmykTex, 'u_cmyk');
      bind(2, this.lutTex, 'u_lut');
      bind(3, this.blueTex || this.lutTex, 'u_blue');

      gl.uniform2f(pr.loc('u_img'), this.imgW, this.imgH);
      gl.uniform1f(pr.loc('u_ppw'), t.extentW);
      gl.uniform1i(pr.loc('u_method'), method);
      gl.uniform1i(pr.loc('u_shape'), SHAPE_ID[P.dotShape] || 0);
      gl.uniform1i(pr.loc('u_bypass'), t.bypass ? 1 : 0);
      gl.uniform1i(pr.loc('u_scan'), t.scan ? 1 : 0);
      gl.uniform1f(pr.loc('u_scanBlur'), P.scanBlur);
      const frac = (x) => x - Math.floor(x);
      gl.uniform2f(pr.loc('u_seed'), 2 * frac(Math.sin(P.seed * 12.9898) * 43758.5453), 2 * frac(Math.sin(P.seed * 78.233) * 43758.5453));
      gl.uniform1f(pr.loc('u_freq'), P.freq);
      gl.uniform1f(pr.loc('u_angle'), P.angle);
      gl.uniform1f(pr.loc('u_dotGain'), P.dotGain);
      gl.uniform1f(pr.loc('u_spread'), P.spread);
      gl.uniform1f(pr.loc('u_sharp'), P.sharp);

      const aspect = this.imgH / this.imgW;
      const mis = [];
      for (const [dx, dy] of MISREG_DIR) mis.push(dx * P.misreg * 0.004, (dy * P.misreg * 0.004) / aspect);
      gl.uniform2fv(pr.loc('u_misreg'), new Float32Array(mis));
      gl.uniform3fv(pr.loc('u_ink'), new Float32Array(inks.flat()));
      const mono = P.colorMode !== 'cmyk';
      gl.uniform4f(pr.loc('u_dens'),
        P.inkDensity * (mono ? 1 : P.densC), P.inkDensity * (mono ? 1 : P.densM),
        P.inkDensity * (mono ? 1 : P.densY), P.inkDensity * P.densK);
      gl.uniform3fv(pr.loc('u_paper'), new Float32Array(hexToLinear(P.paperColor)));
      gl.uniform1f(pr.loc('u_paperTex'), P.paperTex);
      gl.uniform1f(pr.loc('u_mottle'), P.mottle);
      gl.uniform1f(pr.loc('u_grain'), P.grain);
      gl.uniform1f(pr.loc('u_matte'), P.matte);
      gl.uniform3fv(pr.loc('u_bg'), new Float32Array(BG));

      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /** 印刷結果をスキャナの画素格子に描画する (パラメータが変わったときだけ) */
    _scan(P, inks) {
      const gl = this.gl;
      const { w, h } = this.scanSize(P);
      const key = JSON.stringify([P, inks, w, h]);
      if (key === this.scanKey) return;
      this.scanKey = key;
      if (!this.scanTex || w !== this.scanW || h !== this.scanH) {
        if (this.scanTex) gl.deleteTexture(this.scanTex);
        this.scanTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.scanTex);
        gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.scanW = w;
        this.scanH = h;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scanTex, 0);
      this._print(P, inks, { fbo: this.fbo, w, h, originX: 0, originY: 0, extentW: w, extentH: h, flip: 1, bypass: false, scan: true });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, this.scanTex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    /**
     * @param P    パラメータ
     * @param view {scale: 画像1pxあたりのキャンバスpx, tx, ty: 画像左上のキャンバス座標}
     * @param opts {bypass: 元画像を表示}
     */
    render(P, view, opts) {
      const gl = this.gl;
      if (!this.srcTex) return;
      const inks = this._inks(P);
      this._separate(P, inks);
      const bypass = !!(opts && opts.bypass);
      const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
      const extentW = this.imgW * view.scale, extentH = this.imgH * view.scale;

      if (P.scan === 'on' && !bypass) {
        this._scan(P, inks);
        const pr = this.progShow;
        gl.useProgram(pr.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        gl.uniform2f(pr.loc('u_canvas'), cw, ch);
        gl.uniform2f(pr.loc('u_origin'), view.tx, view.ty);
        gl.uniform2f(pr.loc('u_extent'), extentW, extentH);
        gl.uniform1f(pr.loc('u_flip'), -1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.scanTex);
        gl.uniform1i(pr.loc('u_tex'), 0);
        gl.uniform3fv(pr.loc('u_bg'), new Float32Array(BG));
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return;
      }
      this._print(P, inks, { fbo: null, w: cw, h: ch, originX: view.tx, originY: view.ty, extentW, extentH, flip: -1, bypass, scan: false });
    }

    /** 画像全体を PNG Blob にする。スキャン時はスキャン画素数そのまま、それ以外は作業解像度の k 倍 */
    exportBlob(P, k) {
      const canvas = this.canvas;
      const prevW = canvas.width, prevH = canvas.height;
      if (P.scan === 'on') {
        const sz = this.scanSize(P);
        canvas.width = sz.w;
        canvas.height = sz.h;
      } else {
        k = Math.min(k, this.maxExport / Math.max(this.imgW, this.imgH));
        canvas.width = Math.round(this.imgW * k);
        canvas.height = Math.round(this.imgH * k);
      }
      this.render(P, { scale: canvas.width / this.imgW, tx: 0, ty: 0 }, null);
      const size = { w: canvas.width, h: canvas.height };
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve({ blob, ...size }) : reject(new Error('書き出しに失敗しました'))), 'image/png');
        canvas.width = prevW;
        canvas.height = prevH;
      });
    }
  }

  window.OSP = window.OSP || {};
  window.OSP.Renderer = Renderer;
})();
