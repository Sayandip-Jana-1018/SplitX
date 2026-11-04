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
 * The money in the background: coins, notes and bills, each drawn over its own box. Seen
 * square-on from far away, a tilted disc is an ellipse, so nothing needs tracing: the outline,
 * the face and the milled edge all come from flat arithmetic. The rim and edge are polished metal
 * in the palette's own colour, reflecting a simple studio, so they catch the light as they
 * turn. The face stays glass, bending the liquid behind it.
 * uKind: 0 a small coin, 1 a big coin for words to sit on, 2 one that also splits, 3 a note, 4 a bill.
 */
export const COIN_FS = `precision highp float;
uniform sampler2D uSharp;
uniform vec2 uCanvas,uL;
uniform float uLight,uFade,uKind,uCut,uCutAt,uT,uDetail;
uniform vec3 uRimC,uC1,uC2,uGlow;
uniform vec4 uC,uTilt;
varying vec2 vP;
vec3 seg(vec2 p,vec2 a,vec2 b){vec2 ba=b-a,v=p-a-ba*clamp(dot(p-a,ba)/dot(ba,ba),0.,1.);float l=length(v)+1e-5;return vec3(l,v/l);}
vec3 rupee(vec2 p){
  p.y-=.02;
  vec3 d=seg(p,vec2(-.3,.46),vec2(.3,.46));
  vec3 e=seg(p,vec2(-.3,.22),vec2(.3,.22));if(e.x<d.x)d=e;
  e=seg(p,vec2(-.3,-.02),vec2(-.06,-.02));if(e.x<d.x)d=e;
  e=seg(p,vec2(-.3,-.02),vec2(.22,-.5));if(e.x<d.x)d=e;
  vec2 c=p-vec2(-.06,.22);float l=length(c)+1e-5;
  if(c.x>0.){float a=abs(l-.24);if(a<d.x)d=vec3(a,c/l*sign(l-.24));}
  return d;
}
float rnd(float a,float b,float r){vec2 v=vec2(a,b)+r;return min(max(v.x,v.y),0.)+length(max(v,0.))-r;}
float box(vec2 p,vec2 b,float r){vec2 d=abs(p)-b+r;return min(max(d.x,d.y),0.)+length(max(d,0.))-r;}
float bar(vec2 p,float x,float y,float w,float h){return box(p-vec2(x,y),vec2(w,h),h);}
float slice(vec2 q,vec2 d){
  float x=dot(q,d),y=dot(q,vec2(-d.y,d.x));
  float grow=.05*(1.-smoothstep(0.,.03,uCut));
  return rnd(rnd(y*.80902-x*.58779-grow,-y*.80902-x*.58779-grow,.03),length(q)-1.,.04);
}
float paper(vec2 q){
  if(uKind<3.5)return box(q,vec2(1.,.54),.09);
  return max(box(q,vec2(1.,1.46),.1),-(q.y+1.4-abs(fract(q.x*2.5+.5)-.5)*.18));
}
float writing(vec2 q){
  if(uKind<3.5){
    float d=abs(box(q,vec2(.88,.42),.05))-.007;
    d=min(d,abs(length(q)-.31)-.007);
    d=min(d,rupee(q/.44).x*.44-.026);
    return min(d,length(abs(q)-vec2(.62,0.))-.055);
  }
  float d=rupee((q-vec2(0.,.92))/.46).x*.46-.03;
  d=min(d,bar(q,0.,.34,.62,.03));
  for(int i=0;i<3;i++){float y=.08-float(i)*.25;d=min(d,min(bar(q,-.24,y,.38,.03),bar(q,.52,y,.1,.03)));}
  return min(d,bar(q,0.,-.76,.62,.055));
}
float hull(vec2 p,vec2 a0,vec2 b0,float off,float nz){
  float pa=dot(p,a0),pb=dot(p,b0),s=max(abs(pa)-abs(off),0.),k=length(vec2(s/nz,pb));
  return (k-1.)/max(length(vec2(s/(nz*nz),pb)/max(k,1e-4)),1e-3);
}
vec3 lit(vec3 n,vec2 at,float metal){
  vec3 glass=texture2D(uSharp,vec2(at.x/uCanvas.x,1.-at.y/uCanvas.y)).rgb*1.08;
  glass=mix(glass,uC2,uLight*.3);
  vec3 r=vec3(0.,0.,-1.)+2.*n.z*n;
  float up=dot(r.xy,normalize(uL));
  float band=mix(.5+.5*sin(up*5.2+r.z*3.+1.),smoothstep(-.6,.7,up),.55);
  vec3 shine=mix(uC2*(.42+.2*uLight),mix(uC1,vec3(1.),.48+.2*uLight),band);
  vec3 col=mix(glass,shine,metal);
  float sp=pow(max(dot(n,normalize(vec3(uL,.62))),0.),80.);
  float sp2=pow(max(dot(n,normalize(vec3(-uL,.5))),0.),18.);
  float fres=pow(1.-n.z,1.8);
  return col+uRimC*(fres*.45+sp*1.25+sp2*.16)*(1.-uLight*.3);
}
void main(){
  float R=uC.z;vec2 p=(vP-uC.xy)/R;float px=1./R;
  vec2 a0=uTilt.xy,b0=vec2(-a0.y,a0.x);
  float lean=uTilt.z,nz=max(uTilt.w,.04);
  float pa=dot(p,a0),pb=dot(p,b0);
  float cs=cos(uC.w),sn=sin(uC.w);
  bool whole=uKind<1.5,isPaper=uKind>2.5,parts=!whole&&!isPaper;
  float off=whole?(uKind<.5?.1:.075)*lean:(parts?.055*lean:0.);
  vec2 f=vec2((pa-off)/nz,pb);
  vec2 q=vec2(cs*f.x-sn*f.y,-(sn*f.x+cs*f.y));
  vec2 qq=q,gs=vec2(0.),out_=vec2(0.);
  float sd,dist,shD,sway=0.;
  if(whole){
    dist=hull(p,a0,b0,off,nz)*R;shD=hull(p-vec2(.02,.07),a0,b0,off,nz)*R;
    sd=length(q)-1.;gs=q/max(length(q),1e-4);
  }else if(isPaper){
    sd=paper(q);
    float e=.012;
    vec2 g=vec2(paper(q+vec2(e,0.))-paper(q-vec2(e,0.)),paper(q+vec2(0.,e))-paper(q-vec2(0.,e)))/(2.*e);
    vec2 gw=vec2(g.x,-g.y);
    vec2 gf=vec2(cs*gw.x+sn*gw.y,-sn*gw.x+cs*gw.y);
    dist=sd/max(length(vec2(gf.x/nz,gf.y)),.2)*R;shD=dist-R*.03;
    gs=g/max(length(g),1e-4);
  }else{
    float w=1.25664,a=atan(q.y,q.x+1e-5)-uCutAt,i=mod(floor(a/w),5.),mid=(floor(a/w)+.5)*w+uCutAt;
    out_=vec2(cos(mid),sin(mid));
    qq=q-out_*uCut*(1.+.3*sin(i*2.4+1.));
    sway=uCut*(1.7+.6*sin(i*1.7+uT*.4));
    sd=slice(qq,out_);
    vec2 back=vec2(cs,-sn)*2.*off/nz;
    float wallD=min(slice(qq+back*.5,out_),slice(qq+back,out_));
    dist=min(sd,wallD)*R;shD=dist-R*.02;
    if(sd>-.07){float e=.008;gs=vec2(slice(qq+vec2(e,0.),out_)-slice(qq-vec2(e,0.),out_),slice(qq+vec2(0.,e),out_)-slice(qq-vec2(0.,e),out_));gs/=max(length(gs),1e-4);}
  }
  float reach=R*.16+10.;
  float shadow=(.38-uLight*.16)*(1.-smoothstep(0.,reach,shD));
  if(dist>.75){gl_FragColor=vec4(0.,0.,0.,shadow)*uFade;return;}
  float cov=1.-smoothstep(-.75,.75,dist);

  float tc=cos(uCutAt),ts=sin(uCutAt);
  vec2 c=parts?vec2(tc*qq.x+ts*qq.y,-ts*qq.x+tc*qq.y):qq;
  float rho=length(c),th=atan(c.y,c.x+1e-5),rim=0.;
  vec2 t=vec2(0.),tFine=vec2(0.);float ink=0.,metal=.14;
  float bv=smoothstep(isPaper?-.035:-.05,0.,sd);
  t+=gs*bv*bv*1.05;
  if(isPaper){
    t.x+=.09*sin(q.x*3.1+q.y*1.3+uT*.4);t.y+=.06*sin(q.y*2.7-q.x);
    ink=1.-smoothstep(-px,px,writing(q));
    metal=.14+.6*bv;
  }else{
    float fine=uDetail*smoothstep(.12,.45,nz);
    vec2 rd=c/max(rho,1e-4),tg=vec2(-rd.y,rd.x);
    rim=smoothstep(.79,.82,rho);
    metal=mix(R<60.?.42:.2,.86,rim);
    t+=qq*.08+out_*sway;
    float wall=(rho-.805)/.016;t-=rd*exp(-wall*wall)*.7;
    if(R>26.){
      float n=floor(clamp(R*.34,24.,104.)),sec=6.28318/n,a=mod(th+sec*.5,sec)-sec*.5;
      vec2 bp=vec2(rho-.9,a*.9);float bd=length(bp),br=R>150.?.021:.03;
      if(bd<br)t+=(rd*bp.x+tg*bp.y)/br*1.1;
    }
    if(fine>.01&&R>60.){
      if(rho<.785){
        float wave=sin(rho*clamp(R*.9,40.,240.)+2.4*sin(th*12.));
        tFine=rd*wave*.05*fine*(1.-smoothstep(.72,.785,rho));
        ink=max(ink,(1.-smoothstep(px*.5,px*1.5,abs(rho-.6)))*.5*fine);
        ink=max(ink,(1.-smoothstep(px*.5,px*1.5,abs(rho-.77)))*.5*fine);
      }
      if(R>90.&&rho>.61&&rho<.76){
        float sec=.5236,a=mod(th+sec*.5,sec)-sec*.5;
        float gd=rupee(vec2(rho*sin(a),rho*cos(a)-.685)/.095).x*.095-.007;
        ink=max(ink,(1.-smoothstep(-px,px,gd))*.6*fine);
      }
    }
    float big=uKind<.5?1.:(uKind<1.5?.42:.32*(1.-smoothstep(0.,.05,uCut)));
    float gs2=R>90.?.95:1.1;
    if(big>.01&&length(qq)<.7){
      vec3 r=rupee(qq/gs2);float w=.05,gd=r.x*gs2-w;
      t+=r.yz*smoothstep(-w,0.,gd)*(1.-smoothstep(0.,px*1.5,gd))*.85*big;
      ink=max(ink,(1.-smoothstep(-px,px,gd))*big);
    }
  }
  vec2 tw=vec2(t.x,-t.y);
  vec2 tf=vec2(cs*tw.x+sn*tw.y,-sn*tw.x+cs*tw.y);
  vec3 f1=vec3(a0*nz,-lean),f2=vec3(b0,0.),n0=vec3(a0*lean,nz);
  vec3 n=normalize(n0+f1*tf.x+f2*tf.y);
  vec2 at=vP-n.xy*min(R*.42,38.)+(uC.xy-vP)*.07;
  vec2 fw=vec2(tFine.x,-tFine.y);
  n=normalize(n+f1*(cs*fw.x+sn*fw.y)+f2*(-sn*fw.x+cs*fw.y));
  if(uDetail>.5)at+=vec2(sin(q.y*7.+uT*.9),sin(q.x*6.-uT*.7))*min(R*.014,4.);
  vec3 col=lit(n,at,metal);
  float sw=(q.x*.71+q.y*.71+2.4*lean)/.34;
  col+=uRimC*.1*exp(-sw*sw)*(1.-uLight*.5);
  if(!isPaper){float g=mod(th-uT*.45+3.14159,6.28318)-3.14159;col+=uRimC*exp(-g*g/.09)*rim*.5;}
  col=mix(col,uC2*.55,ink*.5*uLight);
  col+=uGlow*ink*.17*(1.-uLight);
  if(parts)col*=1.-.16*(1.-uLight)*(1.-rim);

  if(whole){
    float rf=length(f),capD=(rf-1.)/max(length(vec2(f.x/nz,f.y)/max(rf,1e-4)),1e-3)*R;
    if(capD>-1.){
      float side=lean<0.?-1.:1.,sp=clamp(pb,-1.,1.),a=asin(sp),ca=cos(a);
      vec3 ev=vec3(-side*nz*a0,abs(lean)+.001);
      vec3 ns=normalize(f2*sp+ev*ca+(f2*ca-ev*sp)*sin(a*floor(clamp(R*.7,22.,190.)))*.42);
      col=mix(lit(ns,vP,.92)*.84,col,1.-smoothstep(-.75,.75,capD));
    }
  }else if(parts&&sd>-.01){
    vec2 gw=vec2(gs.x,-gs.y);
    vec3 nw=normalize(f1*(cs*gw.x+sn*gw.y)+f2*(-sn*gw.x+cs*gw.y)+n0*.16);
    vec3 wc=lit(nw,vP,.92)*.82;
    if(rho>.97)wc*=1.+.26*sin(th*floor(clamp(R*.7,22.,190.)));
    col=mix(wc,col,1.-smoothstep(-.75,.75,sd*R));
  }
  gl_FragColor=vec4(col*cov,cov+(1.-cov)*shadow)*uFade;
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
