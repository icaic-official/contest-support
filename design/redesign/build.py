"""Inline shared parts into each mockup: src/*.html -> *.html.

/*DATA*/ becomes src/data.js and <!--SHADCN--> becomes src/_shadcn-head.html.
Files whose names start with "_" are partials and are not built.
"""
import pathlib
here = pathlib.Path(__file__).parent
data = (here / "src/data.js").read_text()
head = (here / "src/_shadcn-head.html").read_text()
for src in sorted((here / "src").glob("*.html")):
    if src.name.startswith("_"):
        continue
    out = src.read_text().replace("/*DATA*/", data).replace("<!--SHADCN-->", head)
    (here / src.name).write_text(out)
    print("built", src.name)
