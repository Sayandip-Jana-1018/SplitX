/**
 * The shaders. The liquid is drawn at low resolution, once for the wall and once, with
 * a blur for frost, for the glass to read, so a glass pixel never recomputes the liquid.
 * Positions are CSS pixels, y down, unless they say otherwise.
 */

const DITHER = '(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.';

/** A triangle over the whole target. */
export const FULL_VS = 'attribute vec2 a;varying vec2 vUv;void main(){vUv=a*.5+.5;gl_Position=vec4(a,0.,1.);}';

/** A rectangle given in the canvas's CSS pixels. */
export const QUAD_VS = `attribute vec2 a;uniform vec4 uQuad;uniform vec2 uCanvas;varying vec2 vP;
void main(){vP=uQuad.xy+a*uQuad.zw;gl_Position=vec4(vP.x/uCanvas.x*2.-1.,1.-vP.y/uCanvas.y*2.,0.,1.);}`;

/**
 * The floating liquid: soft-edged masses that merge and part, glossy at the rim.
 * It lives in the viewport, so it stays put while the page scrolls over it. The
 * theme ripple and the touch ripple bend it here, and glass inherits them by reading it.
 */
export const LIQUID_FS = `precision highp float;
uniform vec2 uView,uL;uniform float uOver,uT,uGloss,uTouchA;
uniform vec3 uA0,uA1,uC1,uC2,uA0p,uA1p,uC1p,uC2p,uGlow,uRip,uTouch;uniform vec3 uBl[7];
varying vec2 vUv;
vec3 gA0,gA1,gC1,gC2;
void pick(vec2 p){
  if(uRip.z<0.){gA0=uA0;gA1=uA1;gC1=uC1;gC2=uC2;return;}
  float s=smoothstep(uRip.z-46.,uRip.z+46.,length(p-uRip.xy));
  gA0=mix(uA0,uA0p,s);gA1=mix(uA1,uA1p,s);gC1=mix(uC1,uC1p,s);gC2=mix(uC2,uC2p,s);
}
vec3 wall(vec2 p){
  vec2 uv=p/uView;
  float g=uv.y+.2*sin(uv.x*2.6+uT*.13)+.12*sin(uv.y*3.4-uT*.1+uv.x*1.3);
  vec3 c=mix(gA0,gA1,smoothstep(-.05,1.05,g));
  float f=0.;vec2 gr=vec2(0.);
  for(int i=0;i<7;i++){vec3 b=uBl[i];vec2 v=p-b.xy;float d2=dot(v,v)+30.;float k=b.z*b.z/d2;f+=k;gr-=2.*k/d2*v;}
  float cov=smoothstep(.975,1.025,f);
  float halo=smoothstep(.38,1.,f)*(1.-cov);
  c=mix(c,gC2,halo*.22);
  if(cov>.001){
    float h=clamp((f-1.)/1.7,0.,1.);float sl=1.-h;
    vec2 gn=gr/(length(gr)+1e-4);
    vec3 n=normalize(vec3(-gn*sl*sl*1.7,1.));
    vec3 body=mix(gC1,gC2,smoothstep(0.,.9,h));
    body=mix(body,gC1,.5*(.5+.5*dot(n.xy,uL)));
    float fres=pow(1.-n.z,1.9);
    float sp=pow(max(dot(n,normalize(vec3(uL,.62))),0.),70.);
    float sp2=pow(max(dot(n,normalize(vec3(-uL,.7))),0.),12.);
    body*=1.+.2*sin(p.y*.011+p.x*.007+uT*.22);
    c=mix(c,body+uGlow*(fres*.6+sp*.9*uGloss+sp2*.12),cov);
  }
  return c;
}
void main(){
  vec2 p=vec2(vUv.x,1.-vUv.y)*(uView+vec2(0.,2.*uOver))-vec2(0.,uOver);
  pick(p);
  if(uRip.z>=0.){float rd=length(p-uRip.xy);float rg=exp(-pow((rd-uRip.z)/34.,2.));p+=normalize(p-uRip.xy+1e-3)*rg*20.;}
  if(uTouchA>0.){float rd=length(p-uTouch.xy);float rg=exp(-pow((rd-uTouch.z)/22.,2.));p+=normalize(p-uTouch.xy+1e-3)*rg*13.*uTouchA;}
  gl_FragColor=vec4(wall(p)+${DITHER},1.);
}`;

/** Halves a texture with four reads. Run twice, it gives frosted glass its blur for almost nothing. */
export const DOWN_FS = `precision highp float;uniform sampler2D uTex;uniform vec2 uTexel;varying vec2 vUv;
void main(){vec2 t=uTexel;gl_FragColor=(texture2D(uTex,vUv+t*vec2(-1.,-1.))+texture2D(uTex,vUv+t*vec2(1.,-1.))+texture2D(uTex,vUv+t*vec2(-1.,1.))+texture2D(uTex,vUv+t*vec2(1.,1.)))*.25;}`;

/**
 * One surface and its shadow. Light bends hardest at the rim and the rim ripples
 * like a liquid; the middle of a surface takes a short path, because almost none
 * of the rim's light reaches it. Nothing here may depend on the surface's height
 * on the screen, or it would shimmer as the page scrolls.
 */
export const GLASS_FS = `precision highp float;
uniform sampler2D uSharp,uSoft;uniform vec2 uCanvas,uL;
uniform float uT,uShadow,uLight,uTintK,uDisperseOn,uUnder;
uniform vec3 uTint,uAcc,uRimC;
uniform vec4 uR,uS,uG;
varying vec2 vP;
vec3 scene(vec2 p,float f){vec2 uv=vec2(p.x/uCanvas.x,1.-p.y/uCanvas.y);return mix(texture2D(uSharp,uv).rgb,texture2D(uSoft,uv).rgb,smoothstep(.05,.6,f));}
float sdRR(vec2 q,vec2 h,float r){vec2 d=abs(q)-h+r;return length(max(d,vec2(0.)))+min(max(d.x,d.y),0.)-r;}
vec2 nRR(vec2 q,vec2 h,float r){float e=.8;vec2 g=vec2(sdRR(q+vec2(e,0.),h,r)-sdRR(q-vec2(e,0.),h,r),sdRR(q+vec2(0.,e),h,r)-sdRR(q-vec2(0.,e),h,r));return g/(length(g)+1e-4);}
vec3 tintOf(vec3 c,float z){float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,1.26);return z<0.?mix(c,uAcc,-z):mix(c,uTint,min(z*uTintK,.94));}
float sheen(vec2 q){vec2 uvn=q/max(uR.zw,vec2(1.));float sl=sin(uT*.2+uR.x*.021)*1.35;return pow(max(1.-abs(uvn.x*.6+uvn.y*.8-sl)/.6,0.),3.)*.05*uG.z*(1.-uS.y*.5);}
void main(){
  vec2 q=vP-uR.xy;
  float r=uS.x;
  float sd=sdRR(q,uR.zw,r);
  float sh=sdRR(q-vec2(0.,7.),uR.zw,r);
  float shadow=uShadow*uS.w*(exp(-max(sh,0.)/16.)*.62+exp(-max(sd,0.)/2.4)*.2)*smoothstep(44.,24.,sd);
  if(sd>=.75){gl_FragColor=vec4(0.,0.,0.,shadow);return;}
  float d=-sd;
  float bev=clamp(min(r,min(uR.z,uR.w)),8.,34.);
  float t=clamp(d/bev,0.,1.);float k=1.-t;
  vec2 o=vec2(sin(q.y*.045+uT*.9+uR.x*.02),cos(q.x*.04-uT*.7))*(1.6+k*5.)*uG.w;
  vec3 c;
  if(d>bev*2.6){
    c=scene(vP+o,uS.y);
    if(uUnder!=0.)c=tintOf(c,uUnder);
    c=tintOf(c,uS.z);
  }else{
    vec2 n=nRR(q,uR.zw,r);
    float disp=(k*k*k*.92+k*.08)*bev*2.25*uG.x;
    o-=n*disp;
    float dsp=.13*uG.y;
    if(uDisperseOn>.5&&disp>.35){c=vec3(scene(vP+o*(1.-dsp),uS.y).r,scene(vP+o,uS.y).g,scene(vP+o*(1.+dsp),uS.y).b);}
    else c=scene(vP+o,uS.y);
    if(uUnder!=0.)c=tintOf(c,uUnder);
    c=tintOf(c,uS.z);
    float dn=dot(n,uL);
    float line=smoothstep(1.6,.1,d);
    float top=pow(max(dn,0.),1.4);float bot=pow(max(-dn,0.),2.)*.62;
    c+=uRimC*line*(.18+top+bot)*uG.z*(1.-uLight*.3);
    float l2=exp(-pow((d-3.4)/1.3,2.));
    c+=uRimC*l2*(.025+.1*max(dn,0.))*uG.z;
    c+=uRimC*exp(-d/(bev*.45))*(.03+.15*max(dn,0.))*uG.z;
    c+=mix(uAcc,uRimC,.55)*exp(-d/(bev*.62))*pow(max(-dn,0.),2.)*.26*uG.z;
    vec3 N=normalize(vec3(n*k*k*1.7,1.));
    float sp=pow(max(dot(N,normalize(vec3(uL,.46))),0.),120.);
    c+=uRimC*sp*.95*uG.z*(1.-uLight*.4);
    c*=1.-uLight*.05*exp(-d/2.2);
  }
  c+=uRimC*sheen(q)+${DITHER};
  float cv=smoothstep(.75,-.75,sd)*uS.w;
  gl_FragColor=vec4(c*cv,cv+(1.-cv)*shadow);
}`;

/**
 * The bloom's petals. Their edges are one or two pixels wide, which the low-resolution
 * liquid can't hold, so they are drawn at the screen's own resolution, over it. Half of
 * the petals are out of reach of any one pixel, so most of the loop skips straight on.
 */
export const BLOOM_FS = `precision highp float;
uniform float uT,uBloomA;uniform vec3 uC1,uC2,uGlow,uBloom;
varying vec2 vP;
void main(){
  vec2 b=(vP-uBloom.xy)/uBloom.z;
  float far=length(b);
  if(far>184.){gl_FragColor=vec4(0.);return;}
  vec3 col=vec3(0.);float alpha=0.;
  float r=uT*.05;float aa=clamp(1.1/uBloom.z,.5,1.6);
  for(int i=0;i<7;i++){
    float fi=float(i);float ang=r+fi*.8976+.2;
    float L=(148.+22.*sin(fi*2.4))*(1.+.025*sin(uT*.6+fi));
    float ca=cos(ang),sa=sin(ang);
    vec2 q=vec2(ca*b.x+sa*b.y,-sa*b.x+ca*b.y);
    float y=-q.y/L;
    if(y<-.02||y>1.02)continue;
    float W=54.+10.*cos(fi*1.7);
    float ky=clamp(y,0.,1.);
    float w=W*sqrt(max(sin(ky*3.14159),0.))*(.72+.5*ky);
    float sd=abs(q.x)-w;
    float ins=smoothstep(-aa,aa,y*L)*smoothstep(-aa,aa,(1.-y)*L);
    float al=smoothstep(aa,-aa,sd)*ins;
    if(al<.002)continue;
    float edge=exp(-abs(sd)/3.5)*ins;
    vec3 pc=mix(uC2,mix(uC1,uGlow,.1+.1*sin(fi)),smoothstep(0.,1.,ky));
    pc+=uGlow*edge*.8;
    pc+=uGlow*.3*exp(-abs(q.x+w*.42)/5.)*smoothstep(.12,.7,ky)*(1.-ky);
    float a=al*(.58+.32*ky);
    col=pc*a+col*(1.-a);
    alpha=a+alpha*(1.-a);
  }
  col+=uC1*.5*exp(-far/26.);
  gl_FragColor=vec4((col+${DITHER}*alpha)*uBloomA,alpha*uBloomA);
}`;

/** Hero droplets: clear drops that pool together, drawn only over the box they occupy. */
export const DROPS_FS = `precision highp float;
uniform sampler2D uSharp;uniform vec2 uCanvas,uL;uniform float uLight;uniform vec3 uRimC;
uniform vec3 uD[10];uniform int uDN;
varying vec2 vP;
float fld(vec2 p){float f=0.;for(int i=0;i<10;i++){if(i>=uDN)break;vec3 d=uD[i];vec2 v=p-d.xy;f+=d.z*d.z/(dot(v,v)+.01);}return f;}
void main(){
  vec2 p=vP;
  float f=fld(p);
  if(f<.62){gl_FragColor=vec4(0.);return;}
  float e=1.5;
  vec2 g=vec2(fld(p+vec2(e,0.))-fld(p-vec2(e,0.)),fld(p+vec2(0.,e))-fld(p-vec2(0.,e)));
  vec2 gn=g/(length(g)+1e-4);
  float h=clamp((f-1.)/1.5,0.,1.);float sl=1.-h;
  vec3 n=normalize(vec3(-gn*sl*sl*1.75,1.));
  vec2 at=p+gn*sl*sl*sl*46.;
  vec3 col=texture2D(uSharp,vec2(at.x/uCanvas.x,1.-at.y/uCanvas.y)).rgb*1.1;
  float sp=pow(max(dot(n,normalize(vec3(uL,.62))),0.),80.);
  float sp2=pow(max(dot(n,normalize(vec3(-uL,.5))),0.),18.);
  float fres=pow(1.-n.z,1.8);
  col+=uRimC*(fres*.6+sp*1.5+sp2*.2);
  float cov=smoothstep(.97,1.03,f);
  float shadow=(.3-uLight*.12)*smoothstep(.62,.98,f);
  gl_FragColor=vec4(col*cov,cov+(1.-cov)*shadow);
}`;
