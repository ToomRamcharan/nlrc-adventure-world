#!/usr/bin/env python3
"""Quick boot/perf probe. Writes /tmp/probe.log and one screenshot."""
import sys, time, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "shots/probe.png"

logs = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=[
        "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu-sandbox",
    ])
    pg = b.new_page(viewport={"width": 720, "height": 1280})
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[ERR] {e}"))
    pg.route("**://fonts.googleapis.com/**", lambda r: r.abort())
    pg.route("**://fonts.gstatic.com/**", lambda r: r.abort())

    t = time.time()
    pg.goto(URL, wait_until="commit", timeout=60000)
    try:
        pg.wait_for_function("window.__DC!==undefined", timeout=120000)
        logs.append(f"== DC-ready {round(time.time()-t,2)}s")
        pg.wait_for_function("window.__DC.level.chunks.length>=18", timeout=180000)
        logs.append(f"== level-ready {round(time.time()-t,2)}s")
    except Exception as e:
        logs.append(f"== FAIL {e}")

    # measure steady-state fps over ~4s of real frames
    try:
        pg.evaluate("window.__fc=0;(function(){const r=requestAnimationFrame;window.requestAnimationFrame=function(c){return r(function(t){window.__fc++;c(t)})}})();")
        pg.wait_for_timeout(500)
        a = pg.evaluate("window.__fc")
        t0 = time.time()
        pg.wait_for_timeout(4000)
        bb = pg.evaluate("window.__fc")
        fps = (bb - a) / (time.time() - t0)
        logs.append(f"== fps(swiftshader) {fps:.1f}")
        st = pg.evaluate("""(()=>{const D=window.__DC,i=D.renderer.info;return{
            draws:i.render.calls,tris:i.render.triangles,
            geos:i.memory.geometries,texs:i.memory.textures,
            progs:i.programs?i.programs.length:-1,
            tex:D.texStats(),mat:D.matStats(),chunks:D.level.chunks.length}})()""")
        logs.append("== stats " + json.dumps(st))
    except Exception as e:
        logs.append(f"== stat-fail {e}")

    try:
        pg.screenshot(path=OUT, timeout=90000)
        logs.append("== shot ok " + OUT)
    except Exception as e:
        logs.append(f"== shot-fail {e}")
    b.close()

txt = "\n".join(logs)
open("/tmp/probe.log", "w").write(txt)
print(txt[-4000:])
