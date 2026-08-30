#!/usr/bin/env python3
"""
Render-inspection harness.

Boots the game in headless Chromium (WebGL via SwiftShader), drives it to a set
of scripted states (menu, running, tunnel, bridge, storm, close-up of the
player, wide canyon vista) and writes PNGs plus a console-error log.

Usage:
  python3 tools/shoot.py --url http://localhost:5173 --out shots/r01
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

SHOTS = [
    # name, teleport z (None = don't), extra js, settle frames
    ("01_menu",        None,  "", 40),
    ("02_start",       None,  "window.__DC.startGame();", 70),
    ("03_run_early",   60,    "", 55),
    ("04_run_mid",     190,   "", 55),
    ("05_tunnel",      None,  "__seek('tunnel');", 65),
    ("06_bridge",      None,  "__seek('bridge');", 65),
    ("07_storm",       None,  "__seek('storm');", 90),
    ("08_mesa",        None,  "__seek('mesa');", 65),
    ("09_fast",        None,  "window.__DC.player.speed=36;", 60),
    ("10_closeup",     None,  "__camRig(2.0, 3.4, 6.0);", 45),
    ("11_vista",       None,  "__camRig(9.0, 14.0, 34.0);", 45),
]

HELPERS = r"""
window.__seek = function(zone){
  const D = window.__DC;
  // walk chunks forward until we find the requested zone
  for (let i=0;i<400;i++){
    const zid = D.level.zoneAt(D.player.z);
    if (zid === zone) break;
    D.player.z += 12;
    D.level.update(0.016, D.player.z);
  }
  // nudge into the middle of the zone
  D.player.z += 22;
  D.level.update(0.016, D.player.z);
  return D.level.zoneAt(D.player.z);
};
window.__camRig = function(back, height, ahead){
  window.__DC.__rig = {back, height, ahead};
};
window.__frames = 0;
(function(){
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function(cb){
    return raf(function(t){ window.__frames++; cb(t); });
  };
})();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173")
    ap.add_argument("--out", default="shots/latest")
    ap.add_argument("--w", type=int, default=900)
    ap.add_argument("--h", type=int, default=1600)
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    logs = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--disable-gpu-sandbox",
                "--no-sandbox",
                "--ignore-gpu-blocklist",
                "--enable-webgl",
                "--disable-dev-shm-usage",
            ],
        )
        page = browser.new_page(viewport={"width": args.w, "height": args.h},
                                device_scale_factor=1)
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))

        # the sandbox has no route to Google Fonts; kill those requests fast
        page.route("**://fonts.googleapis.com/**", lambda r: r.abort())
        page.route("**://fonts.gstatic.com/**", lambda r: r.abort())

        page.add_init_script(HELPERS)
        page.goto(args.url, wait_until="commit", timeout=90000)

        # wait for engine boot
        try:
            page.wait_for_function("window.__DC !== undefined", timeout=240000)
            page.evaluate(HELPERS)
        except Exception as e:
            logs.append(f"[fatal] __DC never appeared: {e}")
            with open(os.path.join(args.out, "console.log"), "w") as f:
                f.write("\n".join(logs))
            browser.close()
            sys.exit(2)

        page.wait_for_timeout(2500)

        only = set(x for x in args.only.split(",") if x)

        for name, z, js, settle in SHOTS:
            if only and name not in only:
                continue
            try:
                if z is not None:
                    page.evaluate(f"""
                        (function(){{
                          const D = window.__DC;
                          if (D.S.mode !== 'playing') D.startGame();
                          D.player.z = {z};
                          for (let i=0;i<3;i++) D.level.update(0.016, D.player.z);
                        }})();
                    """)
                if js:
                    page.evaluate(js)
                # let it settle / animate
                start = page.evaluate("window.__frames||0")
                page.wait_for_function(f"(window.__frames||0) > {start} + {settle}", timeout=30000)
                page.wait_for_timeout(220)
                page.screenshot(path=os.path.join(args.out, f"{name}.png"))
                logs.append(f"[shot] {name} ok")
            except Exception as e:
                logs.append(f"[shot-error] {name}: {e}")

        # gather runtime stats
        try:
            stats = page.evaluate("""
              (function(){
                const D = window.__DC;
                const info = D.renderer.info;
                return {
                  drawCalls: info.render.calls,
                  triangles: info.render.triangles,
                  geometries: info.memory.geometries,
                  textures: info.memory.textures,
                  programs: info.programs ? info.programs.length : -1,
                  playerZ: D.player.z,
                  mode: D.S.mode,
                  chunks: D.level.chunks.length,
                };
              })();
            """)
        except Exception as e:
            stats = {"error": str(e)}

        with open(os.path.join(args.out, "stats.json"), "w") as f:
            json.dump(stats, f, indent=2)
        with open(os.path.join(args.out, "console.log"), "w") as f:
            f.write("\n".join(logs))

        browser.close()

    errs = [l for l in logs if "error" in l.lower() or "pageerror" in l]
    print(json.dumps({"stats": stats, "errors": errs[:40], "shots": args.out}, indent=2))


if __name__ == "__main__":
    main()
