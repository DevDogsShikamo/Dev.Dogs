// Aurora — WebGL fluid gradient in deep blue, reactive to the cursor.
// Mounted by Muten via `Custom Aurora`. Fills its host as an absolute background.
function mount(el, inputs, on) {
  const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const footer = el.closest(".gf") || el.parentElement || el;

  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.zIndex = "0";
  el.style.pointerEvents = "none";

  const cv = document.createElement("canvas");
  cv.style.width = "100%";
  cv.style.height = "100%";
  cv.style.display = "block";
  el.appendChild(cv);

  const gl = cv.getContext("webgl") || cv.getContext("experimental-webgl");
  if (!gl) {
    // Fallback: static aurora gradient if WebGL is unavailable.
    el.style.background = "linear-gradient(135deg,#6d3fb8,#00c2cb 60%,#ec4899)";
    return;
  }

  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = [
    "precision highp float;",
    "uniform vec2 u_res;uniform float u_t;uniform vec2 u_m;",
    "void main(){",
    "  vec2 uv=gl_FragCoord.xy/u_res.xy;vec2 p=uv;float t=u_t*0.09;",
    "  float n=sin(p.x*3.0+t)+sin(p.y*4.0-t*1.3)+sin((p.x+p.y)*3.4+t*0.7)+sin((p.x-p.y)*5.0+t*1.1);",
    "  vec2 m=u_m/u_res.xy;float d=distance(p,m);n+=1.7*exp(-d*3.5)*sin(t*2.2);",
    "  float f=0.5+0.5*sin(n*1.1+t);",
    "  vec3 uva=vec3(0.43,0.25,0.72);",  // #6d3fb8
    "  vec3 cy=vec3(0.0,0.76,0.80);",    // #00c2cb
    "  vec3 pk=vec3(0.93,0.28,0.60);",   // #ec4899
    "  vec3 ink=vec3(0.04,0.03,0.07);",  // casi negro
    "  vec3 col=mix(uva,cy,f);",
    "  col=mix(col,pk,0.5+0.5*sin(n*0.8-t));",
    "  col=mix(ink,col,0.5+0.32*f);",
    "  gl_FragColor=vec4(col,1.0);",
    "}",
  ].join("\n");

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uT = gl.getUniformLocation(prog, "u_t");
  const uM = gl.getUniformLocation(prog, "u_m");

  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  let mouse = [0, 0];
  let raf = 0;
  const t0 = performance.now();

  function resize() {
    const w = el.clientWidth || footer.clientWidth || 1;
    const h = el.clientHeight || footer.clientHeight || 1;
    cv.width = w * dpr;
    cv.height = h * dpr;
    gl.viewport(0, 0, cv.width, cv.height);
    mouse = [cv.width / 2, cv.height * 0.7];
  }
  resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(el);
  else window.addEventListener("resize", resize);

  footer.addEventListener("pointermove", (e) => {
    const r = footer.getBoundingClientRect();
    mouse = [(e.clientX - r.left) * dpr, (r.height - (e.clientY - r.top)) * dpr];
  });

  function draw() {
    const t = (performance.now() - t0) / 1000;
    gl.uniform2f(uRes, cv.width, cv.height);
    gl.uniform1f(uT, t);
    gl.uniform2f(uM, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  if (reduce) {
    // One static frame, no animation loop.
    gl.uniform2f(uRes, cv.width, cv.height);
    gl.uniform1f(uT, 3.0);
    gl.uniform2f(uM, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return;
  }

  // Pause the loop when the footer scrolls off-screen.
  let visible = true;
  if (window.IntersectionObserver) {
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !raf) loop();
    }, { threshold: 0.02 }).observe(footer);
  }
  function loop() {
    if (!visible) { raf = 0; return; }
    draw();
    raf = requestAnimationFrame(loop);
  }
  loop();
}
