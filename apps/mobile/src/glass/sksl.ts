/**
 * The glass, as Skia shaders (SkSL). On the web, one WebGL engine draws the liquid into a texture
 * and the glass reads it back (src/lib/glass/engine.ts). Here the liquid is a function of the
 * screen point and the time, so every surface draws the same liquid at its own place on screen,
 * bent by its own edge, and nothing is read back from the GPU. The wall and the glass agree to
 * the pixel because they run the same function.
 */
import { COIN_FS } from '@shared/glass/shaders';

/**
 * The liquid: the website's LIQUID_FS, with both its ripples. The theme ripple is a ring that
 * spreads from where a new colour was chosen, the new colours inside it and the old outside; the
 * touch ripple is a smaller ring from a finger. Each bends the liquid as it passes. `soft` from 0
 * to 1 is frost: wider edges and less shine, which looks like blur and costs nothing.
 */
const LIQUID_FN = `
uniform float2 uView;
uniform float2 uL;
uniform float uT;
uniform float uGloss;
uniform float3 uA0;
uniform float3 uA1;
uniform float3 uC1;
uniform float3 uC2;
uniform float3 uGlow;
uniform float3 uBl[7];
uniform float3 uTouch;
uniform float uTouchA;
uniform float3 uRip;
uniform float3 uA0p;
uniform float3 uA1p;
uniform float3 uC1p;
uniform float3 uC2p;

float3 liquid(float2 p, float soft) {
  float3 a0 = uA0;
  float3 a1 = uA1;
  float3 c1 = uC1;
  float3 c2 = uC2;
  if (uRip.z >= 0.) {
    float rd = length(p - uRip.xy);
    float s = smoothstep(uRip.z - 46., uRip.z + 46., rd);
    a0 = mix(uA0, uA0p, s);
    a1 = mix(uA1, uA1p, s);
    c1 = mix(uC1, uC1p, s);
    c2 = mix(uC2, uC2p, s);
    float q = (rd - uRip.z)/34.;
    p += normalize(p - uRip.xy + 1e-3)*exp(-q*q)*20.;
  }
  if (uTouchA > 0.) {
    float q = (length(p - uTouch.xy) - uTouch.z)/22.;
    p += normalize(p - uTouch.xy + 1e-3)*exp(-q*q)*13.*uTouchA;
  }
  float2 uv = p / uView;
  float g = uv.y + .2*sin(uv.x*2.6 + uT*.13) + .12*sin(uv.y*3.4 - uT*.1 + uv.x*1.3);
  float3 c = mix(a0, a1, smoothstep(-.05, 1.05, g));
  float f = 0.;
  float2 gr = float2(0.);
  for (int i = 0; i < 7; i++) {
    float3 b = uBl[i];
    float2 v = p - b.xy;
    float d2 = dot(v, v) + 30.;
    float k = b.z*b.z/d2;
    f += k;
    gr -= 2.*k/d2*v;
  }
  float edge = .025 + soft*.32;
  float cov = smoothstep(1. - edge, 1. + edge, f);
  float halo = smoothstep(.38, 1., f)*(1. - cov);
  c = mix(c, c2, halo*.22);
  if (cov > .001) {
    float h = clamp((f - 1.)/1.7, 0., 1.);
    float sl = 1. - h;
    float2 gn = gr/(length(gr) + 1e-4);
    float3 n = normalize(float3(-gn*sl*sl*1.7, 1.));
    float3 body = mix(c1, c2, smoothstep(0., .9, h));
    body = mix(body, c1, .5*(.5 + .5*dot(n.xy, uL)));
    float fres = pow(1. - n.z, 1.9);
    float sp = pow(max(dot(n, normalize(float3(uL, .62))), 0.), 70.);
    float sp2 = pow(max(dot(n, normalize(float3(-uL, .7))), 0.), 12.);
    body *= 1. + .2*sin(p.y*.011 + p.x*.007 + uT*.22);
    float shine = 1. - soft*.8;
    c = mix(c, body + uGlow*(fres*.6*shine + sp*.9*uGloss*shine + sp2*.12), cov);
  }
  return c;
}
`;

/** The wall behind every screen. */
export const LIQUID_SKSL = `${LIQUID_FN}
half4 main(float2 xy) {
  float3 c = liquid(xy, 0.);
  float d = fract(sin(dot(xy, float2(12.9898, 78.233)))*43758.5453) - .5;
  return half4(half3(c + d/255.), 1.);
}
`;

/**
 * One glass surface, drawn over its own box with room around it for its shadow: the web's
 * GLASS_FS, reading the liquid at the bent point instead of from a texture.
 */
export const SURFACE_SKSL = `${LIQUID_FN}
uniform float2 uOrigin;
uniform float2 uInset;
uniform float2 uSize;
uniform float uRadius;
uniform float uFrost;
uniform float uTint;
uniform float uTintK;
uniform float3 uTintC;
uniform float3 uAcc;
uniform float uRefract;
uniform float uRim;
uniform float uWobble;
uniform float uLight;
uniform float3 uRimC;
uniform float uShadow;
uniform float2 uAt;

float sdRR(float2 q, float2 hs, float r) {
  float2 d = abs(q) - hs + r;
  return length(max(d, float2(0.))) + min(max(d.x, d.y), 0.) - r;
}
float2 nRR(float2 q, float2 hs, float r) {
  float e = .8;
  float2 g = float2(sdRR(q + float2(e, 0.), hs, r) - sdRR(q - float2(e, 0.), hs, r),
                    sdRR(q + float2(0., e), hs, r) - sdRR(q - float2(0., e), hs, r));
  return g/(length(g) + 1e-4);
}
float3 tintOf(float3 c, float z) {
  float l = dot(c, float3(.2126, .7152, .0722));
  c = mix(float3(l), c, 1.26);
  return z < 0. ? mix(c, uAcc, -z) : mix(c, uTintC, min(z*uTintK, .94));
}
half4 main(float2 at) {
  // A layer draws many panes in one canvas: uAt is where this one's box starts in it.
  float2 xy = at - uAt;
  float2 hs = uSize*.5;
  float2 q = xy - uInset - hs;
  float r = min(uRadius, min(hs.x, hs.y));
  float sd = sdRR(q, hs, r);
  float sh = sdRR(q - float2(0., 7.), hs, r);
  // The shadow fades out before the canvas ends, so its edge never shows as a box.
  float shadow = uShadow*(exp(-max(sh, 0.)/16.)*.62 + exp(-max(sd, 0.)/2.4)*.2)*(1. - smoothstep(uInset.x*.35, uInset.x - 2., sd));
  if (sd >= .75) { return half4(0., 0., 0., half(shadow)); }
  float d = -sd;
  float bev = clamp(min(r, min(hs.x, hs.y)), 8., 34.);
  float k = 1. - clamp(d/bev, 0., 1.);
  float2 n = nRR(q, hs, r);
  float2 o = float2(sin(q.y*.045 + uT*.9 + uOrigin.x*.02), cos(q.x*.04 - uT*.7))*(1.6 + k*5.)*uWobble;
  float disp = (k*k*k*.92 + k*.08)*bev*2.25*uRefract;
  float3 c = tintOf(liquid(uOrigin + xy + o - n*disp, uFrost), uTint);
  float dn = dot(n, uL);
  float line = 1. - smoothstep(.1, 1.6, d);
  float top = pow(max(dn, 0.), 1.4);
  float bot = pow(max(-dn, 0.), 2.)*.62;
  c += uRimC*line*(.18 + top + bot)*uRim*(1. - uLight*.3);
  float band = (d - 3.4)/1.3;
  c += uRimC*exp(-band*band)*(.025 + .1*max(dn, 0.))*uRim;
  c += uRimC*exp(-d/(bev*.45))*(.03 + .15*max(dn, 0.))*uRim;
  c += mix(uAcc, uRimC, .55)*exp(-d/(bev*.62))*pow(max(-dn, 0.), 2.)*.26*uRim;
  float3 nn = normalize(float3(n*k*k*1.7, 1.));
  c += uRimC*pow(max(dot(nn, normalize(float3(uL, .46))), 0.), 120.)*.95*uRim*(1. - uLight*.4);
  float2 uvn = q/max(hs, float2(1.));
  float sl = sin(uT*.2 + uOrigin.x*.021)*1.35;
  c += uRimC*pow(max(1. - abs(uvn.x*.6 + uvn.y*.8 - sl)/.6, 0.), 3.)*.05*uRim*(1. - uFrost*.5);
  c *= 1. - uLight*.05*exp(-d/2.2);
  float cv = 1. - smoothstep(-.75, .75, sd);
  return half4(half3(c*cv), half(cv + (1. - cv)*shadow));
}
`;

/**
 * The coins: the website's COIN_FS itself, converted, so a change to the coin shows on both.
 * It fails loudly if that shader changes shape, rather than drawing something wrong.
 */
export function coinSkSL(glsl: string = COIN_FS): string {
    const swaps: [string, string][] = [
        ['precision highp float;\n', ''],
        ['uniform sampler2D uSharp;\n', ''],
        ['uniform vec2 uCanvas,uL;\n', ''],
        ['uniform float uLight,uFade,uKind,uCut,uCutAt,uT,uDetail;', 'uniform float uLight;uniform float uFade;uniform float uKind;uniform float uCut;uniform float uCutAt;uniform float uDetail;'],
        ['uniform vec3 uRimC,uC1,uC2,uGlow;', 'uniform vec3 uRimC;'],
        ['uniform vec4 uC,uTilt;', 'uniform vec4 uC;uniform vec4 uTilt;uniform vec2 uOrigin;'],
        ['varying vec2 vP;\n', ''],
        ['texture2D(uSharp,vec2(at.x/uCanvas.x,1.-at.y/uCanvas.y)).rgb', 'liquid(at,0.)'],
        ['void main(){', 'half4 main(float2 xy){vec2 vP=xy+uOrigin;'],
        ['{gl_FragColor=vec4(0.,0.,0.,shadow)*uFade;return;}', '{return half4(0.,0.,0.,half(shadow*uFade));}'],
        ['gl_FragColor=vec4(col*cov,cov+(1.-cov)*shadow)*uFade;', 'return half4(vec4(col*cov,cov+(1.-cov)*shadow)*uFade);'],
    ];
    let source = glsl.replace(/\r\n/g, '\n');
    for (const [from, to] of swaps) {
        if (!source.includes(from)) throw new Error(`The web's coin shader changed: "${from.slice(0, 48)}" is gone`);
        source = source.split(from).join(to);
    }
    source = source.replace(/\bvec([234])\b/g, 'float$1');
    return `${LIQUID_FN}\n${source}`;
}
