// GLSL for the optional background shader and the compositing / post chain.
// Background looks live in SCENE (pick one per frame with cfg.scene). For richer looks
// (raymarched blob, metaballs, op-art, ASCII, halftone, duotone, rays) add a function per look
// and a branch for it in sceneColor() below.

export const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv; out vec4 o;
#define PI 3.14159265
#define TAU 6.2831853
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,s,-s,c); }
`;

// Background looks. uP/uQ/uR are free vec4 params set per frame from the scene (cfg.P/Q/R); for
// more inputs, declare a uniform here and pass it in gl.js subframe(). Coordinates: gl_FragCoord.y
// is 0 at the BOTTOM row, while Canvas2D y is 0 at the top, so flip y (uRes.y - y) to line up with 2D art.
//   1 gradient : drifting two-colour fbm gradient.  uP.rgb = colour A, uQ.rgb = colour B, uP.w = drift speed
//   2 paper    : warm paper with fibres + soft vignette (folksy / print looks).  uP.rgb = paper colour
//   3 grid     : fine tech grid with a travelling glow line.  uP.rgb = base, uQ.rgb = line colour, uQ.w = glow
export const SCENE = COMMON + `
uniform vec2 uRes; uniform float uT; uniform int uScene;
uniform vec4 uP; uniform vec4 uQ; uniform vec4 uR; uniform vec2 uJit;
// Also available, already wired in gl.js (declare them to use them; unused ones are skipped):
//   uniform sampler2D uTex;   the 2D canvas of this subframe (set cfg.consume2D to hide the plain copy)
//   uniform float uL;         free scalar (cfg.l)
//   uniform vec4 uBlobs[12];  12 free vec4s (cfg.blobs, Float32Array(48)), e.g. metaball centres and radii
vec3 bgGradient(vec2 fc){
  vec2 p=fc/uRes.y;
  float n=fbm(p*1.6+vec2(uT*0.05*uP.w, -uT*0.03*uP.w));
  float g=smoothstep(0.15,0.85, p.y*0.6+n*0.7);
  return mix(uP.rgb,uQ.rgb,g);
}
vec3 bgPaper(vec2 fc){
  vec2 p=fc/uRes.y;
  float fib=fbm(p*vec2(9.,120.))*0.5+fbm(p*vec2(140.,8.))*0.5;
  float blot=fbm(p*3.+11.);
  vec3 c=uP.rgb*(0.94+0.06*fib)*(0.97+0.05*blot);
  vec2 d=fc/uRes-0.5;
  return c*(1.-0.35*dot(d,d));
}
vec3 bgGrid(vec2 fc){
  vec2 p=fc/uRes.y*14.;
  vec2 g=abs(fract(p)-0.5);
  float line=smoothstep(0.48,0.5,max(g.x,g.y));
  float sweep=exp(-pow((fc.y/uRes.y-fract(uT*0.25))*9.,2.));
  vec3 c=uP.rgb+uQ.rgb*line*(0.10+0.5*sweep*uQ.w);
  return c+uQ.rgb*0.05*fbm(fc/uRes.y*3.+uT*0.1);
}
vec3 sceneColor(int id, vec2 fc){
  if(id==1) return bgGradient(fc);
  if(id==2) return bgPaper(fc);
  if(id==3) return bgGrid(fc);
  return vec3(0.);
}
void main(){
  vec2 fc=gl_FragCoord.xy+uJit;
  o=vec4(sceneColor(uScene, fc),1.);
}`;

// Composite one subframe (GL background + 2D layer, through a virtual camera) into the
// accumulation buffer. Colour is premultiplied; alpha is tracked so --alpha renders work.
// uCam = (zoom, rotation, panX, panY).
export const COMP = COMMON + `
uniform sampler2D uBg, uL2; uniform int uUseBg, uUse2D, uBlend;
uniform vec3 uClear; uniform float uClearA; uniform vec4 uCam; uniform vec2 uRes; uniform float uW;
void main(){
  float asp=uRes.x/uRes.y;
  vec2 p=(vUv-0.5)*vec2(asp,1.);
  p=rot(-uCam.y)*p/uCam.x - uCam.zw;
  vec2 uv=p/vec2(asp,1.)+0.5;
  vec3 col=uClear*uClearA; float a=uClearA;
  bool inside = uv.x>=0.&&uv.x<=1.&&uv.y>=0.&&uv.y<=1.;
  if(uUseBg==1 && inside){ col=texture(uBg,uv).rgb; a=1.; }
  if(uUse2D==1 && inside){
    vec4 l=texture(uL2,uv);
    if(uBlend==0){ col=col*(1.-l.a)+l.rgb; a=a*(1.-l.a)+l.a; }
    else { vec3 s=l.rgb/max(l.a,1e-4); col=mix(col, abs(col-s), l.a); a=a*(1.-l.a)+l.a; }   // difference blend
  }
  o=vec4(col*uW, a*uW);
}`;

export const BRIGHT = COMMON + `
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThr;
void main(){
  vec3 c=vec3(0.);
  c+=texture(uSrc,vUv+uTexel*vec2(-1,-1)).rgb; c+=texture(uSrc,vUv+uTexel*vec2(1,-1)).rgb;
  c+=texture(uSrc,vUv+uTexel*vec2(-1,1)).rgb;  c+=texture(uSrc,vUv+uTexel*vec2(1,1)).rgb;
  c*=0.25;
  float l=max(c.r,max(c.g,c.b));
  o=vec4(c*smoothstep(uThr,uThr+0.35,l),1.);
}`;

export const BLUR = COMMON + `
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  vec3 c=texture(uSrc,vUv).rgb*0.2270270270;
  c+=(texture(uSrc,vUv+uDir*1.3846153846).rgb+texture(uSrc,vUv-uDir*1.3846153846).rgb)*0.3162162162;
  c+=(texture(uSrc,vUv+uDir*3.2307692308).rgb+texture(uSrc,vUv-uDir*3.2307692308).rgb)*0.0702702703;
  o=vec4(c,1.);
}`;

// Final post: glitch, chromatic aberration, bloom, vignette, HUD (difference), flash, grain, fade.
// In alpha mode (uAlpha=1) bloom extends coverage so glows survive over video, and the output
// is un-premultiplied because ProRes 4444 / VP9 alpha expect straight alpha.
export const FINAL = COMMON + `
uniform sampler2D uSrc, uB1, uB2, uHud; uniform vec2 uRes; uniform int uAlpha;
uniform float uT, uBloom, uCA, uGlitch, uGrain, uVig, uFlash, uFade, uHudA;
void main(){
  vec2 uv=vUv;
  float fr=floor(uT*60.);
  if(uGlitch>0.001){
    float row=floor(uv.y*18.+hash12(vec2(fr,3.))*7.);
    float h=hash12(vec2(row,fr));
    if(h<uGlitch*0.55) uv.x+=(hash12(vec2(row*1.7,fr+9.))-0.5)*0.22*uGlitch;
    float blk=hash12(floor(uv*vec2(12.,7.))+fr);
    if(blk<uGlitch*0.08) uv=fract(uv+vec2(hash12(vec2(fr,1.))-.5,0.)*0.3);
  }
  vec2 d=uv-0.5;
  float ca=uCA+uGlitch*0.018;
  // Chromatic aberration splits channels; one straight alpha can't hold per-channel coverage, so in
  // alpha mode it is skipped (otherwise fringes come out as opaque solid-colour outlines over footage).
  if(uAlpha==1) ca=0.;
  vec4 s0=texture(uSrc,uv-d*ca), s1=texture(uSrc,uv), s2=texture(uSrc,uv+d*ca);
  vec3 col=vec3(s0.r,s1.g,s2.b);
  float a=s1.a;
  vec3 bl=texture(uB1,uv).rgb*0.9+texture(uB2,uv).rgb*1.4;
  col+=bl*uBloom;
  if(uAlpha==1) a=clamp(a+max(bl.r,max(bl.g,bl.b))*uBloom,0.,1.);
  col*=1.-uVig*dot(d,d)*1.6;
  vec4 hud=texture(uHud,vUv);
  if(hud.a>0.){ vec3 s=hud.rgb/max(hud.a,1e-4); col=mix(col, abs(col-s), hud.a*uHudA); if(uAlpha==1) a=max(a,hud.a*uHudA); }
  col=mix(col,vec3(1.),uFlash);
  float g=hash12(vUv*uRes+fract(uT*7.31)*917.)-0.5;
  if(uAlpha==1){
    a=mix(a,1.,uFlash);
    col+=g*uGrain*a;
    col*=uFade; a*=uFade;
    col=clamp(col,0.,1.);
    o=vec4(clamp(col/max(a,1e-4),0.,1.), a);
  } else {
    col+=g*uGrain;
    col*=uFade;
    o=vec4(clamp(col,0.,1.),1.);
  }
}`;
