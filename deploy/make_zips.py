import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "deploy", "dist")
os.makedirs(OUT, exist_ok=True)


def zip_dir(src_dir, zip_path, arc_root_name):
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(src_dir):
            for fn in files:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, src_dir)
                arcname = os.path.join(arc_root_name, rel)
                zf.write(full, arcname)
    print(f"wrote {zip_path}")


theme_src = os.path.join(ROOT, "wp-content", "themes", "fourliberty")
plugin_src = os.path.join(ROOT, "wp-content", "plugins", "4liberty-hub")

zip_dir(theme_src, os.path.join(OUT, "fourliberty-theme.zip"), "fourliberty")
zip_dir(plugin_src, os.path.join(OUT, "4liberty-hub-plugin.zip"), "4liberty-hub")
