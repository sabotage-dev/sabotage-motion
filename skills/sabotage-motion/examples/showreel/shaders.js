// GLSL for the showreel: its background looks in one "mega shader" (SCENE, picked per frame with cfg.scene) and the
// template's compositing and post chain, unchanged (COMP, BRIGHT, BLUR, FINAL). The looks, by cfg.scene id:
//   1 raymarched SDF blob, iridescent, with an environment map (uP = morph, pulse, orbiters, camera distance)
//   2 liquid metaballs over a cobalt ground, the 2D layer refracted through them (uBlobs, uQ = flood line, waves)
//   3 op-art rings  4 ASCII render of the blob  5 halftone  6 duotone blob  7 stripes
//   8 climax: rays, a nebula and rings around the end card's mark (uP = rays, ring radius, ring, nebula; uQ.xy = centre)
// cfg.l = 1 floods the liquid in over whichever look is up (the reel no longer uses it: it cuts to the liquid on the beat).

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
float smin(float a,float b,float k){ float h=clamp(.5+.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
`;

export const SCENE = COMMON + `
uniform vec2 uRes; uniform float uT; uniform float uL;   // uL: cfg.l, 1 while the liquid floods in over another look
uniform int uScene;
uniform vec4 uP; uniform vec4 uQ; uniform vec4 uR; uniform vec2 uJit;
uniform sampler2D uTex;
uniform vec4 uBlobs[12];

const vec3 INK=vec3(0.043,0.043,0.051), PAPER=vec3(0.949,0.929,0.894), EMBER=vec3(1.,0.29,0.11),
           COBALT=vec3(0.169,0.231,1.), LIME=vec3(0.831,1.,0.227), PINK=vec3(1.,0.373,0.635), VIOLET=vec3(0.48,0.3,1.);

// ------------------------------------------------------------------ 3D SDF blob
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdTorus(vec3 p, vec2 t){ vec2 q=vec2(length(p.xz)-t.x,p.y); return length(q)-t.y; }
float sdOcta(vec3 p, float s){ p=abs(p); return (p.x+p.y+p.z-s)*0.57735027; }
float shapeSD(int i, vec3 p){
  if(i==0) return length(p)-1.0;
  if(i==1){ vec3 q=p; q.yz*=rot(PI*0.5); return sdTorus(q, vec2(0.86,0.34)); }
  if(i==2){ vec3 q=p; q.xz*=rot(q.y*1.3); return sdBox(q, vec3(0.6))-0.2; }
  if(i==3){ return sdOcta(p,1.3)-0.1; }
  return length(p)-0.95 + 0.09*sin(7.*p.x)*sin(7.*p.y)*sin(7.*p.z);
}
float mapBlob(vec3 p){
  vec3 q=p;
  q.xz*=rot(uT*0.8); q.xy*=rot(sin(uT*0.6)*0.5);
  float m=uP.x; int i0=int(floor(m)); float f=fract(m); f=f*f*(3.-2.*f);
  float d = mix(shapeSD(i0,q), shapeSD(min(i0+1,4),q), f);
  d -= uP.y*0.07*sin(5.*q.x+uT*5.)*sin(5.*q.y+uT*4.)*sin(5.*q.z+uT*6.);
  float orb=uP.z;
  for(int k=0;k<3;k++){
    float a=uT*1.7+float(k)*2.0944;
    vec3 c=vec3(cos(a)*orb, sin(uT*2.3+float(k)*1.7)*0.35*orb, sin(a)*orb);
    d=smin(d, length(p-c)-0.2, 0.5);
  }
  return d;
}
vec3 blobN(vec3 p){ vec2 e=vec2(8e-4,0);
  return normalize(vec3(mapBlob(p+e.xyy)-mapBlob(p-e.xyy), mapBlob(p+e.yxy)-mapBlob(p-e.yxy), mapBlob(p+e.yyx)-mapBlob(p-e.yyx))); }
vec3 envMap(vec3 rd){
  float y=rd.y; float a=atan(rd.x,-rd.z);
  vec3 c = mix(vec3(0.012,0.012,0.018), vec3(0.05,0.05,0.07), smoothstep(-0.6,0.7,y));
  c += vec3(1.0,0.97,0.92)*smoothstep(0.72,0.92,y)*1.6;
  c += EMBER*1.2*smoothstep(0.32,0.0,abs(a-1.9))*smoothstep(-0.5,0.1,y)*smoothstep(0.95,0.45,y)*2.6;
  c += COBALT*1.2*smoothstep(0.34,0.0,abs(a+1.6))*smoothstep(-0.6,0.3,y)*2.4;
  c += LIME*smoothstep(0.1,0.0,abs(a-0.4))*smoothstep(0.06,0.0,abs(y+0.08))*1.6;
  c += PINK*0.7*smoothstep(0.5,0.0,abs(a-3.0))*smoothstep(0.2,-0.4,y);
  return c;
}
vec3 renderBlob(vec2 fc, out float lum, out float cov){
  vec2 p=(fc-0.5*uRes)/uRes.y;
  vec3 ro=vec3(0.,0.12,uP.w);
  ro.xz*=rot(sin(uT*0.45)*0.35);
  vec3 ww=normalize(-ro), uu=normalize(cross(ww,vec3(0,1,0))), vv=cross(uu,ww);
  vec3 rd=normalize(p.x*uu+p.y*vv+1.37*ww);
  float vg = length(p);
  vec3 bg = mix(vec3(0.05,0.035,0.06), vec3(0.012,0.012,0.02), smoothstep(0.,0.9,vg));
  bg += EMBER*0.10*exp(-4.*vg);
  float t=0.; bool hit=false;
  for(int i=0;i<120;i++){ float d=mapBlob(ro+rd*t); if(d<0.0006*t){hit=true;break;} t+=d*0.8; if(t>14.) break; }
  vec3 col=bg; cov=0.;
  if(hit){
    cov=1.;
    vec3 pos=ro+rd*t, n=blobN(pos), r=reflect(rd,n);
    float nv=max(dot(n,-rd),0.);
    float fre=pow(1.-nv,3.);
    vec3 irid=0.5+0.5*cos(TAU*(vec3(0.0,0.33,0.67)+nv*1.25+uT*0.12+pos.y*0.2));
    vec3 refl=envMap(r);
    col = refl*mix(vec3(1.0), irid*1.35, 0.6);
    col += fre*vec3(0.85,0.8,1.0)*0.55;
    col += EMBER*0.05;
    float ao=0., sc=1.;
    for(int k=1;k<=4;k++){ float h=0.05*float(k); ao+=(h-mapBlob(pos+n*h))*sc; sc*=0.7; }
    col*=clamp(1.-ao*2.5,0.,1.);
    col=1.-exp(-col*1.25);
  }
  lum=dot(col,vec3(0.299,0.587,0.114));
  return col;
}

// ------------------------------------------------------------------ liquid metaballs
float liquidSD(vec2 p){
  float d=1e3;
  for(int i=0;i<12;i++){ vec4 b=uBlobs[i]; if(b.z<=0.) continue; d=smin(d, length(p-b.xy)-b.z, 0.13); }
  float wave=(0.016*sin(p.x*8.+uT*2.5)+0.009*sin(p.x*17.-uT*3.6)+0.005*sin(p.x*29.+uT*4.5))*uQ.z;
  float fl = p.y-(uQ.x+wave);
  if(uQ.y>0.) fl = abs(fl)-uQ.y;
  return smin(d, fl, 0.1);
}
vec4 renderLiquid(vec2 fc, bool transparent){
  vec2 p=(fc-0.5*uRes)/uRes.y;
  float d=liquidSD(p);
  float px=1.25/uRes.y;
  float cov=smoothstep(px,-px,d);
  vec2 e=vec2(0.0025,0.);
  vec2 g=vec2(liquidSD(p+e.xy)-liquidSD(p-e.xy), liquidSD(p+e.yx)-liquidSD(p-e.yx))/(2.*e.x);
  float h=clamp(-d*9.,0.,1.);
  float edge=1.-h;
  vec3 n=normalize(vec3(-g*edge*1.8, 0.25+h));
  vec3 L=normalize(vec3(-0.45,0.65,0.75));
  float dif=max(dot(n,L),0.);
  float spec=pow(max(dot(reflect(-L,n),vec3(0,0,1)),0.),60.);
  float spec2=pow(max(dot(reflect(-normalize(vec3(0.6,-0.3,0.7)),n),vec3(0,0,1)),0.),20.);
  vec3 base=mix(EMBER, PINK, smoothstep(-0.45,0.45,p.y+0.18*sin(p.x*2.6+uT*1.3)));
  base=mix(base, vec3(1.,0.76,0.18), smoothstep(0.55,0.8,fbm(p*2.5+vec2(uT*0.4,-uT*0.3)))*0.6);
  vec2 tuv=fc/uRes + n.xy*0.012*edge + n.xy*0.004;   // a gentle refraction: a strong one swept the word across its own pixels
  vec4 tx=texture(uTex, tuv);
  vec3 col=base*(0.5+0.6*dif);
  col=mix(col, vec3(0.95,0.92,0.88), tx.a*0.85*uQ.w);   // the word stays light inside the liquid as outside it (no flash at the edges)
  col+=spec*0.45+spec2*vec3(0.5,0.6,1.)*0.15;
  col+=pow(edge,4.)*0.12;
  if(transparent) return vec4(col,cov);
  vec3 bgc=mix(vec3(0.05,0.06,0.42), COBALT, smoothstep(-0.7,0.6,p.y));
  bgc*=0.85+0.15*fbm(p*1.5+uT*0.1);
  vec4 btx=texture(uTex, fc/uRes);
  bgc=bgc*(1.-btx.a*uQ.w)+btx.rgb*uQ.w;
  // soft contact shadow of liquid on background
  float sh=smoothstep(0.12,0.0,liquidSD(p+vec2(-0.02,0.03)));
  bgc*=1.-sh*0.35;
  return vec4(mix(bgc,col,cov),1.);
}

// ------------------------------------------------------------------ style frames
vec3 renderOpArt(vec2 fc){
  vec2 p=(fc-0.5*uRes)/uRes.y;
  vec2 c1=vec2(sin(uT*0.31)*0.3, cos(uT*0.23)*0.12), c2=vec2(-sin(uT*0.22)*0.34, sin(uT*0.34)*0.14);
  float a=step(0.5,fract(length(p-c1)*26.-uT*0.5));
  float b=step(0.5,fract(length(p-c2)*26.+uT*0.5));
  return mix(INK, PAPER, abs(a-b));
}
vec3 renderHalftone(vec2 fc){
  vec2 p=(fc-0.5*uRes)/uRes.y;
  float ang=0.45, cell=0.03;
  vec2 q=rot(ang)*p; vec2 gi=floor(q/cell); vec2 f=fract(q/cell)-0.5;
  vec2 cp=rot(-ang)*((gi+0.5)*cell);
  float v=0.5+0.5*sin(length(cp-vec2(0.1,0.))*13.-uT*1.5);
  v=mix(v, 0.5+0.5*sin(cp.x*9.+uT*0.8), 0.35);
  v*=smoothstep(1.1,0.2,length(cp*vec2(0.8,1.2)));
  float r=sqrt(clamp(v,0.,1.))*0.62;
  float m=smoothstep(0.04,-0.04,length(f)-r);
  return mix(PAPER, EMBER, m);
}
float glyph(int n, vec2 p){
  p=floor(p*vec2(-4.,4.)+2.5);
  if(clamp(p.x,0.,4.)==p.x && clamp(p.y,0.,4.)==p.y){ int a=int(round(p.x)+5.*round(p.y)); if(((n>>a)&1)==1) return 1.; }
  return 0.;
}
vec3 renderAscii(vec2 fc){
  vec2 cellPx=vec2(20.,24.)*uRes.y/1080.;
  vec2 cid=floor(fc/cellPx); vec2 center=(cid+0.5)*cellPx;
  float lum, cov; renderBlob(center, lum, cov);
  float g=clamp(lum*2.4,0.,1.);
  int n=0;
  if(g>0.04) n=4096; if(g>0.1) n=65600; if(g>0.18) n=332772; if(g>0.28) n=15255086;
  if(g>0.4) n=23385164; if(g>0.52) n=15252014; if(g>0.66) n=13199452; if(g>0.8) n=11512810;
  vec2 lp=fract(fc/cellPx)*2.-1.;
  float ch=glyph(n, lp*vec2(1.0,0.9));
  vec3 tint=mix(LIME, vec3(1.), smoothstep(0.6,1.,g));
  vec3 col=tint*ch*(0.35+0.9*g);
  col+=LIME*0.04*step(0.5,fract(fc.y/3.));
  return col;
}
vec3 renderDuotone(vec2 fc){
  float lum, cov; renderBlob(fc, lum, cov);
  float v=floor(clamp(lum*1.6,0.,0.999)*5.)/4.;
  vec3 col = v<0.25 ? COBALT*0.9 : v<0.5 ? VIOLET : v<0.75 ? PINK : v<1. ? vec3(1.,0.8,0.5) : PAPER;
  vec2 p=fc/uRes.y;
  float lines=step(0.5,fract((p.x+p.y)*90.));
  col=mix(col, col*0.8, lines*0.35*(1.-cov));
  return col;
}
vec3 renderStripes(vec2 fc){
  vec2 p=(fc-0.5*uRes)/uRes.y;
  p*=rot(0.62+uT*0.08);
  float w=p.x*9.+sin(p.y*5.+uT*1.2)*0.55*sin(uT*0.6)-uT*0.6;
  return mix(INK, LIME, step(0.5,fract(w)));
}
vec3 renderClimax(vec2 fc){
  vec2 p=(fc-0.5*uRes)/uRes.y - uQ.xy;
  float r=length(p), a=atan(p.y,p.x);
  vec3 col=vec3(0.028,0.02,0.026);
  col+=COBALT*0.10*fbm(p*2.5+vec2(uT*0.15,-uT*0.1))*uP.w;
  col+=EMBER*0.06*fbm(p*4.-vec2(uT*0.2,0.))*uP.w;
  float rays=pow(vnoise(vec2(a*5.,uT*0.9)),3.)+0.6*pow(vnoise(vec2(a*12.+7.,-uT*1.3)),4.);
  col+=mix(EMBER,vec3(1.,0.7,0.5),0.3)*rays*exp(-r*2.2)*uP.x;
  col+=EMBER*0.3*exp(-r*7.)*uP.x;
  float ring=exp(-pow((r-uP.y)*30.,2.))*uP.z;
  float ring2=exp(-pow((r-uP.y*0.72)*55.,2.))*uP.z*0.5;
  col+=vec3(1.,0.85,0.7)*ring + EMBER*ring2;
  return col;
}

vec4 sceneColor(int id, vec2 fc){
  float l, c;
  if(id==1) return vec4(renderBlob(fc,l,c),1.);
  if(id==2) return renderLiquid(fc,false);
  if(id==3) return vec4(renderOpArt(fc),1.);
  if(id==4) return vec4(renderAscii(fc),1.);
  if(id==5) return vec4(renderHalftone(fc),1.);
  if(id==6) return vec4(renderDuotone(fc),1.);
  if(id==7) return vec4(renderStripes(fc),1.);
  if(id==8) return vec4(renderClimax(fc),1.);
  return vec4(INK,1.);
}
void main(){
  vec2 fc=gl_FragCoord.xy+uJit;
  vec4 a=sceneColor(uScene, fc);
  if(uL>0.5){ vec4 b=renderLiquid(fc,true); a.rgb=mix(a.rgb,b.rgb,b.a); }
  o=vec4(a.rgb,1.);
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
